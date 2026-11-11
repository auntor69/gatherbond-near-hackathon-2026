//! GatherBond — crypto-backed commitments for real-world events.
//!
//! M2 implementation: multi-event escrow with registration, organizer check-in,
//! cancellation, permissionless finalization, per-reservation pull claims, treasury
//! accrual and a measured storage-reserve policy.
//!
//! # Accounting model
//!
//! Every liability the contract owes is counted exactly once:
//!
//! ```text
//! total_liability = Σ_event(refund_pool + reward_pool) + treasury_accrued
//! pending_total   = Σ in-flight payout amounts (claims + treasury withdrawals)
//! storage stake   = env::storage_usage() * env::storage_byte_cost()
//! buffer          = max(0.001 NEAR, stake / 20)
//! ```
//!
//! with the invariant
//!
//! ```text
//! balance >= total_liability + pending_total + stake + buffer
//! ```
//!
//! checked whenever a state change can affect it. Moving an amount from a pool into
//! `pending_total` keeps the sum constant, so the check performed at initiation is
//! also the proof that the transfer receipt cannot fail for lack of balance.
//!
//! Because payouts are single-flight **per event** (plus one global treasury lock),
//! more than one payout may be in flight at a time; callbacks therefore perform local
//! accounting only and never assert the global invariant.
//!
//! # Storage policy
//!
//! Storage growth is paid from funded surplus, never from refundable deposits: at
//! registration the balance grows by the deposit and `total_liability` grows by the
//! same amount, so a registration is admitted only if the *pre-existing* surplus
//! covers the measured `storage_usage()` delta. Organizers attach a non-refundable
//! storage contribution to `create_event`; it is disclosed in the UI and documented
//! in the README. No byte-per-attendee estimate is ever used for admission.

use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError,
};

/// Gas statically reserved for a payout callback.
const CALLBACK_GAS: Gas = Gas::from_tgas(15);

/// Minimum prepaid gas required to schedule a payout with a callback.
const MIN_PAYOUT_GAS: Gas = Gas::from_tgas(30);

/// Buffer policy floor (0.001 NEAR).
const RESERVE_BUFFER_MIN: u128 = 1_000_000_000_000_000_000_000;

/// MVP capacity cap: bounds per-event work and storage on testnet.
const MAX_CAPACITY: u32 = 500;

/// Maximum page size for bounded views.
const MAX_PAGE: u32 = 20;

const MAX_NETWORK_ID_LEN: usize = 32;
const MAX_SECRET_LEN: usize = 128;

/// Disclosed non-refundable storage contribution required to create an event (0.01 NEAR).
const MIN_EVENT_STORAGE: u128 = 10_000_000_000_000_000_000_000;

/// Domain separator for the one-time ticket commitment.
const COMMITMENT_DOMAIN: &[u8] = b"GatherBond:v1";

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
pub enum StorageKey {
    Events,
    Reservations,
    AccountEvents,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EventStatus {
    Open,
    Cancelled,
    Finalized,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ClaimStatus {
    /// Entitlement available, not yet requested.
    Unclaimed,
    /// Transfer scheduled; waiting for the callback.
    Pending,
    /// Transfer confirmed by callback.
    Claimed,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Event {
    pub organizer: AccountId,
    pub metadata_hash: [u8; 32],
    pub deposit: u128,
    pub capacity: u32,
    pub registered: u32,
    pub checked_in: u32,
    pub start_at: u64,
    pub end_at: u64,
    pub registration_deadline: u64,
    pub checkin_open: u64,
    pub checkin_close: u64,
    pub status: EventStatus,
    /// Remaining deposit liability (`D` per still-eligible attendee).
    pub refund_pool: u128,
    /// Remaining no-show reward liability.
    pub reward_pool: u128,
    /// Snapshot of the per-attendee reward, fixed at finalization.
    pub reward_per_attendee: u128,
    /// Single-flight payout lock for this event.
    pub lock: bool,
    pub lock_nonce: u64,
    pub lock_amount: u128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reservation {
    pub event_id: u64,
    pub attendee: AccountId,
    pub deposit: u128,
    /// SHA-256 ticket commitment; the secret is never stored on-chain.
    pub ticket_commitment: [u8; 32],
    pub checked_in: bool,
    pub checked_in_at: u64,
    pub claim: ClaimStatus,
}

#[near(serializers = [json])]
pub struct EventView {
    pub event_id: u64,
    pub organizer: AccountId,
    pub metadata_hash: [u8; 32],
    pub deposit: U128,
    pub capacity: u32,
    pub registered: u32,
    pub checked_in: u32,
    pub start_at: U64,
    pub end_at: U64,
    pub registration_deadline: U64,
    pub checkin_open: U64,
    pub checkin_close: U64,
    pub status: EventStatus,
    pub refund_pool: U128,
    pub reward_pool: U128,
    pub reward_per_attendee: U128,
    pub locked: bool,
}

#[near(serializers = [json])]
pub struct ReservationView {
    pub event_id: u64,
    pub attendee: AccountId,
    pub deposit: U128,
    pub checked_in: bool,
    pub checked_in_at: U64,
    pub claim: ClaimStatus,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct GatherBond {
    /// Account allowed to withdraw accrued treasury funds.
    pub treasury: AccountId,
    /// Network identity bound into ticket commitments (e.g. "testnet").
    pub network_id: String,
    pub next_event_id: u64,
    pub events: LookupMap<u64, Event>,
    pub reservations: LookupMap<(u64, AccountId), Reservation>,
    /// Event ids per attendee, for bounded history views.
    pub account_events: LookupMap<AccountId, Vec<u64>>,
    /// Σ event pools + accrued treasury.
    pub total_liability: u128,
    /// Σ in-flight payout amounts.
    pub pending_total: u128,
    pub treasury_accrued: u128,
    pub treasury_lock: bool,
    pub treasury_nonce: u64,
    pub treasury_pending: u128,
    /// Measured storage bytes of the most recent growing receipt.
    pub last_storage_delta: u64,
    pub max_record_bytes: u64,
}

#[near]
impl GatherBond {
    /// Creates the contract. Any attached deposit becomes the bootstrap storage reserve.
    #[init]
    #[payable]
    pub fn new(treasury: AccountId, network_id: String) -> Self {
        require!(
            !network_id.is_empty() && network_id.len() <= MAX_NETWORK_ID_LEN,
            format!("network_id must be 1..={MAX_NETWORK_ID_LEN} bytes")
        );

        Self {
            treasury,
            network_id,
            next_event_id: 0,
            events: LookupMap::new(StorageKey::Events),
            reservations: LookupMap::new(StorageKey::Reservations),
            account_events: LookupMap::new(StorageKey::AccountEvents),
            total_liability: 0,
            pending_total: 0,
            treasury_accrued: 0,
            treasury_lock: false,
            treasury_nonce: 0,
            treasury_pending: 0,
            last_storage_delta: 0,
            max_record_bytes: 0,
        }
    }

    /// Tops up the storage reserve. Permissionless.
    #[payable]
    pub fn fund_reserve(&mut self) {
        near_sdk::log!(
            "Storage reserve funded with {} yoctoNEAR by {}",
            env::attached_deposit().as_yoctonear(),
            env::predecessor_account_id()
        );
    }

    /// Creates an event with immutable financial and timing rules.
    ///
    /// The attached deposit is a disclosed, non-refundable storage contribution. It is
    /// credited to the contract balance and must cover the measured event record and
    /// the reserve buffer, otherwise this reverts.
    #[payable]
    pub fn create_event(
        &mut self,
        deposit: U128,
        capacity: u32,
        start_at: U64,
        end_at: U64,
        registration_deadline: U64,
        checkin_open: U64,
        checkin_close: U64,
        metadata_hash: [u8; 32],
    ) -> U64 {
        let now = env::block_timestamp();
        let deposit = deposit.0;
        let (start_at, end_at, reg_deadline, ck_open, ck_close) = (
            start_at.0,
            end_at.0,
            registration_deadline.0,
            checkin_open.0,
            checkin_close.0,
        );

        require!(deposit > 0, "Deposit must be greater than zero");
        require!(
            capacity > 0 && capacity <= MAX_CAPACITY,
            format!("Capacity must be between 1 and {MAX_CAPACITY}")
        );
        require!(now < start_at, "Event must start in the future");
        require!(start_at < end_at, "Event start must be before end");
        require!(
            reg_deadline > now && reg_deadline <= start_at,
            "Registration deadline must be in the future and no later than the start"
        );
        require!(
            ck_open >= reg_deadline && ck_open < ck_close && ck_close <= end_at,
            "Check-in must open after registration closes and close by the event end"
        );

        let contribution = env::attached_deposit().as_yoctonear();
        require!(
            contribution >= MIN_EVENT_STORAGE,
            format!(
                "Event storage contribution of at least {MIN_EVENT_STORAGE} yoctoNEAR is required"
            )
        );

        let event_id = self.next_event_id;
        self.next_event_id = event_id.checked_add(1).expect("Event id overflow");

        let event = Event {
            organizer: env::predecessor_account_id(),
            metadata_hash,
            deposit,
            capacity,
            registered: 0,
            checked_in: 0,
            start_at,
            end_at,
            registration_deadline: reg_deadline,
            checkin_open: ck_open,
            checkin_close: ck_close,
            status: EventStatus::Open,
            refund_pool: 0,
            reward_pool: 0,
            reward_per_attendee: 0,
            lock: false,
            lock_nonce: 0,
            lock_amount: 0,
        };

        let before = env::storage_usage();
        self.events.insert(event_id, event);
        self.events.flush();
        let delta = env::storage_usage().saturating_sub(before);
        self.last_storage_delta = delta;
        self.max_record_bytes = self.max_record_bytes.max(delta);

        self.assert_solvent("create_event");

        near_sdk::log!(
            "Event {} created by {} (deposit {} yoctoNEAR, storage +{} bytes)",
            event_id,
            env::predecessor_account_id(),
            deposit,
            delta
        );

        U64::from(event_id)
    }

    /// Registers the caller for an event by attaching the exact deposit and a ticket
    /// commitment. The commitment hides the ticket secret until check-in.
    #[payable]
    pub fn register(&mut self, event_id: U64, ticket_commitment: [u8; 32]) -> ReservationView {
        let attendee = env::predecessor_account_id();
        let attached = env::attached_deposit().as_yoctonear();
        let event_id = event_id.0;

        let mut event = self.event_or_panic(event_id);
        require!(
            event.status == EventStatus::Open,
            "Event is not open for registration"
        );
        require!(!event.lock, "Settlement in flight for this event");
        require!(
            env::block_timestamp() < event.registration_deadline,
            "Registration deadline has passed"
        );
        require!(event.registered < event.capacity, "Event capacity is full");
        require!(
            attached == event.deposit,
            format!(
                "Exact deposit required: expected {} yoctoNEAR, attached {} yoctoNEAR",
                event.deposit, attached
            )
        );
        require!(
            !self
                .reservations
                .contains_key(&(event_id, attendee.clone())),
            "Already registered for this event"
        );

        let reservation = Reservation {
            event_id,
            attendee: attendee.clone(),
            deposit: event.deposit,
            ticket_commitment,
            checked_in: false,
            checked_in_at: 0,
            claim: ClaimStatus::Unclaimed,
        };

        // Measure the real growth of the two records written below.
        let before = env::storage_usage();
        self.reservations
            .insert((event_id, attendee.clone()), reservation.clone());
        self.reservations.flush();
        let mut ids = self
            .account_events
            .get(&attendee)
            .cloned()
            .unwrap_or_default();
        ids.push(event_id);
        self.account_events.insert(attendee.clone(), ids);
        self.account_events.flush();
        let delta = env::storage_usage().saturating_sub(before);
        self.last_storage_delta = delta;
        self.max_record_bytes = self.max_record_bytes.max(delta);

        event.registered = event
            .registered
            .checked_add(1)
            .expect("Registration overflow");
        event.refund_pool = event
            .refund_pool
            .checked_add(event.deposit)
            .expect("Refund pool overflow");
        let liability = event.deposit;
        self.events.insert(event_id, event);
        self.events.flush();
        self.total_liability = self
            .total_liability
            .checked_add(liability)
            .expect("Liability overflow");

        // The attached deposit cancels against the new liability; only the measured
        // storage growth has to be covered by pre-existing surplus.
        self.assert_solvent("register");

        near_sdk::log!(
            "Registered {} for event {} (storage +{} bytes)",
            attendee,
            event_id,
            delta
        );

        Self::reservation_view(&reservation)
    }

    /// Organizer-only one-time check-in. Verifies the ticket secret against the stored
    /// commitment inside the check-in window, which may open before the event starts.
    pub fn check_in(
        &mut self,
        event_id: U64,
        attendee: AccountId,
        secret: String,
    ) -> ReservationView {
        let event_id = event_id.0;
        let event = self.event_or_panic(event_id);

        require!(
            env::predecessor_account_id() == event.organizer,
            "Only the event organizer can check in attendees"
        );
        require!(event.status == EventStatus::Open, "Event is not open");
        require!(!event.lock, "Settlement in flight for this event");

        let now = env::block_timestamp();
        require!(
            now >= event.checkin_open && now <= event.checkin_close,
            "Check-in window is closed"
        );
        require!(
            !secret.is_empty() && secret.len() <= MAX_SECRET_LEN,
            format!("Ticket secret must be 1..={MAX_SECRET_LEN} bytes")
        );

        let mut reservation = self
            .reservations
            .get(&(event_id, attendee.clone()))
            .cloned()
            .unwrap_or_else(|| env::panic_str("No reservation for this attendee"));
        require!(!reservation.checked_in, "Ticket already used");

        let expected = ticket_commitment(
            &self.network_id,
            &env::current_account_id(),
            event_id,
            &attendee,
            &secret,
        );
        require!(
            expected == reservation.ticket_commitment,
            "Invalid ticket for this attendee"
        );

        reservation.checked_in = true;
        reservation.checked_in_at = now;
        self.reservations
            .insert((event_id, attendee.clone()), reservation.clone());
        self.reservations.flush();

        let mut event = event;
        event.checked_in = event
            .checked_in
            .checked_add(1)
            .expect("Attendance overflow");
        self.events.insert(event_id, event);
        self.events.flush();

        near_sdk::log!("Checked in {} for event {}", attendee, event_id);
        Self::reservation_view(&reservation)
    }

    /// Owner-authorized ticket recovery. The attendee replaces the commitment with a
    /// fresh secret, invalidating any old ticket code. This is deliberately narrow:
    /// it cannot change the deposit, attendance, settlement pools or claim state.
    pub fn rotate_ticket_commitment(
        &mut self,
        event_id: U64,
        ticket_commitment: [u8; 32],
    ) -> ReservationView {
        let attendee = env::predecessor_account_id();
        let event_id = event_id.0;
        let event = self.event_or_panic(event_id);

        require!(event.status == EventStatus::Open, "Event is not open");
        require!(!event.lock, "Settlement in flight for this event");
        require!(
            env::block_timestamp() <= event.checkin_close,
            "Check-in window is closed"
        );

        let mut reservation = self
            .reservations
            .get(&(event_id, attendee.clone()))
            .cloned()
            .unwrap_or_else(|| env::panic_str("No reservation for this attendee"));
        require!(!reservation.checked_in, "Ticket already used");

        reservation.ticket_commitment = ticket_commitment;
        self.reservations
            .insert((event_id, attendee.clone()), reservation.clone());
        self.reservations.flush();

        near_sdk::log!(
            "Rotated ticket commitment for {} on event {}; old ticket invalidated",
            attendee,
            event_id
        );
        Self::reservation_view(&reservation)
    }

    /// Organizer-only cancellation before the event starts. Every registered attendee
    /// can then claim exactly their deposit back.
    pub fn cancel_event(&mut self, event_id: U64) {
        let event_id = event_id.0;
        let mut event = self.event_or_panic(event_id);

        require!(
            env::predecessor_account_id() == event.organizer,
            "Only the event organizer can cancel"
        );
        require!(event.status == EventStatus::Open, "Event is not open");
        require!(!event.lock, "Settlement in flight for this event");
        require!(
            env::block_timestamp() < event.start_at,
            "Event can only be cancelled before it starts"
        );

        event.status = EventStatus::Cancelled;
        self.events.insert(event_id, event);
        self.events.flush();

        near_sdk::log!("Event {} cancelled; deposits are refundable", event_id);
    }

    /// Permissionless finalization after the event ends. Snapshots attendance and
    /// computes the reward share; the liability total is unchanged by design.
    pub fn finalize_event(&mut self, event_id: U64) -> EventView {
        let event_id = event_id.0;
        let mut event = self.event_or_panic(event_id);

        require!(event.status == EventStatus::Open, "Event is not open");
        require!(!event.lock, "Settlement in flight for this event");
        require!(
            env::block_timestamp() >= event.end_at,
            "Event cannot be finalized before it ends"
        );

        let checked = u128::from(event.checked_in);
        let registered = u128::from(event.registered);
        let pool = registered
            .checked_sub(checked)
            .expect("Attendance exceeds registrations")
            .checked_mul(event.deposit)
            .expect("Reward pool overflow");

        let (reward, remainder) = if checked > 0 {
            let reward = pool / checked;
            (reward, pool - reward * checked)
        } else {
            (0, pool)
        };

        event.refund_pool = checked
            .checked_mul(event.deposit)
            .expect("Refund pool overflow");
        event.reward_pool = reward.checked_mul(checked).expect("Reward pool overflow");
        event.reward_per_attendee = reward;
        event.status = EventStatus::Finalized;

        // Identity check: checked*D + reward*checked + remainder == registered*D.
        let distributed = event
            .refund_pool
            .checked_add(event.reward_pool)
            .expect("Settlement overflow")
            .checked_add(remainder)
            .expect("Settlement overflow");
        debug_assert_eq!(distributed, registered * event.deposit);

        self.treasury_accrued = self
            .treasury_accrued
            .checked_add(remainder)
            .expect("Treasury overflow");
        self.events.insert(event_id, event.clone());
        self.events.flush();

        near_sdk::log!(
            "Event {} finalized: {} registered, {} attended, reward {}, remainder {}",
            event_id,
            registered,
            checked,
            reward,
            remainder
        );

        Self::event_view(event_id, &event)
    }

    /// Claims the caller's settlement (deposit plus reward when applicable) for a
    /// finalized or cancelled event. Uses a per-event single-flight payout lock.
    pub fn claim_settlement(&mut self, event_id: U64) -> Promise {
        let caller = env::predecessor_account_id();
        let event_id = event_id.0;

        require!(
            env::prepaid_gas() >= MIN_PAYOUT_GAS,
            format!(
                "Insufficient prepaid gas: {} attached, {} required to reserve {} for the callback",
                env::prepaid_gas().as_gas(),
                MIN_PAYOUT_GAS.as_gas(),
                CALLBACK_GAS.as_gas()
            )
        );

        let mut event = self.event_or_panic(event_id);
        require!(event.status != EventStatus::Open, "Event is not finalized");
        require!(!event.lock, "Settlement in flight for this event");

        let mut reservation = self
            .reservations
            .get(&(event_id, caller.clone()))
            .cloned()
            .unwrap_or_else(|| env::panic_str("No reservation for caller"));
        require!(
            reservation.claim == ClaimStatus::Unclaimed,
            "Reservation is not claimable"
        );

        let (refund, reward) = Self::entitlement(&event, &reservation);
        let amount = refund.checked_add(reward).expect("Claim overflow");
        require!(amount > 0, "No refund or reward for this reservation");
        require!(
            event.refund_pool >= refund && event.reward_pool >= reward,
            "Event settlement pool is exhausted"
        );

        // Checked while the amount is still part of the event pools; this is what
        // guarantees the transfer receipt cannot fail for lack of balance.
        self.assert_solvent("claim_settlement");

        event.refund_pool -= refund;
        event.reward_pool -= reward;
        event.lock = true;
        event.lock_nonce = event
            .lock_nonce
            .checked_add(1)
            .expect("Lock nonce overflow");
        event.lock_amount = amount;
        let nonce = event.lock_nonce;

        reservation.claim = ClaimStatus::Pending;

        self.events.insert(event_id, event);
        self.events.flush();
        self.reservations
            .insert((event_id, caller.clone()), reservation);
        self.reservations.flush();

        self.total_liability = self
            .total_liability
            .checked_sub(amount)
            .expect("Liability underflow");
        self.pending_total = self
            .pending_total
            .checked_add(amount)
            .expect("Pending overflow");

        near_sdk::log!(
            "Claim initiated for {} on event {}: {} yoctoNEAR (nonce {})",
            caller,
            event_id,
            amount,
            nonce
        );

        Promise::new(caller.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_claim_callback(event_id, caller, nonce),
            )
    }

    /// Resolves a claim transfer. Total by construction: stale or unexpected state is a
    /// logged no-op that keeps the lock, never an unwind after funds have moved.
    #[private]
    pub fn on_claim_callback(
        &mut self,
        #[callback_result] call_result: Result<(), PromiseError>,
        event_id: u64,
        attendee: AccountId,
        nonce: u64,
    ) -> bool {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Method on_claim_callback is private"
        );

        let Some(mut event) = self.events.get(&event_id).cloned() else {
            near_sdk::log!("Claim callback for unknown event {}; ignored", event_id);
            return false;
        };
        if !event.lock || event.lock_nonce != nonce {
            near_sdk::log!(
                "Ignoring stale claim callback for event {} (nonce {} vs {})",
                event_id,
                nonce,
                event.lock_nonce
            );
            return false;
        }

        let Some(mut reservation) = self
            .reservations
            .get(&(event_id, attendee.clone()))
            .cloned()
        else {
            near_sdk::log!("Claim callback without reservation; keeping lock");
            return false;
        };
        if reservation.claim != ClaimStatus::Pending {
            near_sdk::log!("Claim callback for non-pending reservation; keeping lock");
            return false;
        }

        let amount = event.lock_amount;
        self.pending_total = self.pending_total.saturating_sub(amount);

        match call_result {
            Ok(_) => {
                reservation.claim = ClaimStatus::Claimed;
                event.lock = false;
                event.lock_amount = 0;
                self.reservations
                    .insert((event_id, attendee.clone()), reservation);
                self.reservations.flush();
                self.events.insert(event_id, event);
                self.events.flush();
                near_sdk::log!("Claim settled for {} on event {}", attendee, event_id);
                true
            }
            Err(_) => {
                // Restore the entitlement from the same rules the claim used.
                let (refund, reward) = Self::entitlement(&event, &reservation);
                reservation.claim = ClaimStatus::Unclaimed;
                event.refund_pool = event.refund_pool.saturating_add(refund);
                event.reward_pool = event.reward_pool.saturating_add(reward);
                event.lock = false;
                event.lock_amount = 0;
                self.total_liability = self.total_liability.saturating_add(amount);
                self.reservations
                    .insert((event_id, attendee.clone()), reservation);
                self.reservations.flush();
                self.events.insert(event_id, event);
                self.events.flush();
                near_sdk::log!(
                    "Claim transfer failed for {} on event {}; entitlement restored",
                    attendee,
                    event_id
                );
                false
            }
        }
    }

    /// Treasury-only withdrawal of accrued treasury funds, bounded by
    /// `treasury_accrued` so it can never invade attendee liabilities.
    pub fn withdraw_treasury(&mut self, amount: U128) -> Promise {
        let amount = amount.0;
        require!(
            env::predecessor_account_id() == self.treasury,
            "Only the treasury account can withdraw"
        );
        require!(!self.treasury_lock, "Treasury withdrawal already in flight");
        require!(amount > 0, "Withdrawal amount must be greater than zero");
        require!(
            amount <= self.treasury_accrued,
            format!(
                "Withdrawal {} exceeds accrued treasury {}",
                amount, self.treasury_accrued
            )
        );
        require!(
            env::prepaid_gas() >= MIN_PAYOUT_GAS,
            format!(
                "Insufficient prepaid gas: {} attached, {} required to reserve {} for the callback",
                env::prepaid_gas().as_gas(),
                MIN_PAYOUT_GAS.as_gas(),
                CALLBACK_GAS.as_gas()
            )
        );

        self.assert_solvent("withdraw_treasury");

        self.treasury_accrued -= amount;
        self.total_liability -= amount;
        self.pending_total = self
            .pending_total
            .checked_add(amount)
            .expect("Pending overflow");
        self.treasury_lock = true;
        self.treasury_nonce = self
            .treasury_nonce
            .checked_add(1)
            .expect("Treasury nonce overflow");
        self.treasury_pending = amount;
        let nonce = self.treasury_nonce;

        near_sdk::log!(
            "Treasury withdrawal of {} yoctoNEAR initiated (nonce {})",
            amount,
            nonce
        );

        Promise::new(self.treasury.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_treasury_callback(nonce),
            )
    }

    /// Resolves a treasury withdrawal. No attendee liability is touched.
    #[private]
    pub fn on_treasury_callback(
        &mut self,
        #[callback_result] call_result: Result<(), PromiseError>,
        nonce: u64,
    ) -> bool {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Method on_treasury_callback is private"
        );

        if !self.treasury_lock || self.treasury_nonce != nonce {
            near_sdk::log!(
                "Ignoring stale treasury callback (nonce {} vs {})",
                nonce,
                self.treasury_nonce
            );
            return false;
        }

        let amount = self.treasury_pending;
        self.treasury_pending = 0;
        self.treasury_lock = false;
        self.pending_total = self.pending_total.saturating_sub(amount);

        match call_result {
            Ok(_) => {
                near_sdk::log!("Treasury withdrawal of {} confirmed", amount);
                true
            }
            Err(_) => {
                self.treasury_accrued = self.treasury_accrued.saturating_add(amount);
                self.total_liability = self.total_liability.saturating_add(amount);
                near_sdk::log!("Treasury withdrawal failed; {} restored", amount);
                false
            }
        }
    }

    // --- Internal helpers ---

    fn event_or_panic(&self, event_id: u64) -> Event {
        self.events
            .get(&event_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Event not found"))
    }

    /// Refund and reward owed to a reservation under the current event state.
    fn entitlement(event: &Event, reservation: &Reservation) -> (u128, u128) {
        match event.status {
            EventStatus::Open => (0, 0),
            EventStatus::Cancelled => (event.deposit, 0),
            EventStatus::Finalized => {
                if reservation.checked_in {
                    (event.deposit, event.reward_per_attendee)
                } else {
                    (0, 0)
                }
            }
        }
    }

    fn storage_stake(&self) -> u128 {
        u128::from(env::storage_usage())
            .checked_mul(env::storage_byte_cost().as_yoctonear())
            .expect("Storage stake overflow")
    }

    fn buffer_for(stake: u128) -> u128 {
        (stake / 20).max(RESERVE_BUFFER_MIN)
    }

    fn required_balance(&self) -> u128 {
        let stake = self.storage_stake();
        self.total_liability
            .checked_add(self.pending_total)
            .expect("Required balance overflow")
            .checked_add(stake)
            .expect("Required balance overflow")
            .checked_add(Self::buffer_for(stake))
            .expect("Required balance overflow")
    }

    fn assert_solvent(&self, stage: &str) {
        let stake = self.storage_stake();
        let buffer = Self::buffer_for(stake);
        let required = self
            .total_liability
            .checked_add(self.pending_total)
            .expect("Required balance overflow")
            .checked_add(stake)
            .expect("Required balance overflow")
            .checked_add(buffer)
            .expect("Required balance overflow");
        let balance = env::account_balance().as_yoctonear();
        require!(
            balance >= required,
            format!(
                "Insufficient solvency at {stage}: balance {balance} yoctoNEAR < required {required} \
                 (liabilities {} + pending {} + storage {} + buffer {})",
                self.total_liability, self.pending_total, stake, buffer
            )
        );
    }

    fn event_view(event_id: u64, event: &Event) -> EventView {
        EventView {
            event_id,
            organizer: event.organizer.clone(),
            metadata_hash: event.metadata_hash,
            deposit: U128::from(event.deposit),
            capacity: event.capacity,
            registered: event.registered,
            checked_in: event.checked_in,
            start_at: U64::from(event.start_at),
            end_at: U64::from(event.end_at),
            registration_deadline: U64::from(event.registration_deadline),
            checkin_open: U64::from(event.checkin_open),
            checkin_close: U64::from(event.checkin_close),
            status: event.status,
            refund_pool: U128::from(event.refund_pool),
            reward_pool: U128::from(event.reward_pool),
            reward_per_attendee: U128::from(event.reward_per_attendee),
            locked: event.lock,
        }
    }

    fn reservation_view(reservation: &Reservation) -> ReservationView {
        ReservationView {
            event_id: reservation.event_id,
            attendee: reservation.attendee.clone(),
            deposit: U128::from(reservation.deposit),
            checked_in: reservation.checked_in,
            checked_in_at: U64::from(reservation.checked_in_at),
            claim: reservation.claim,
        }
    }

    // --- Views ---

    pub fn get_event(&self, event_id: U64) -> Option<EventView> {
        self.events
            .get(&event_id.0)
            .map(|event| Self::event_view(event_id.0, event))
    }

    /// Bounded, paginated event listing. `limit` is clamped to [`MAX_PAGE`].
    pub fn get_events(&self, from: U64, limit: u32) -> Vec<EventView> {
        let limit = limit.min(MAX_PAGE);
        let mut out = Vec::new();
        let mut id = from.0;
        while id < self.next_event_id && out.len() < limit as usize {
            if let Some(event) = self.events.get(&id) {
                out.push(Self::event_view(id, event));
            }
            id += 1;
        }
        out
    }

    pub fn get_event_count(&self) -> U64 {
        U64::from(self.next_event_id)
    }

    pub fn get_reservation(&self, event_id: U64, account_id: AccountId) -> Option<ReservationView> {
        self.reservations
            .get(&(event_id.0, account_id))
            .map(Self::reservation_view)
    }

    /// Bounded, paginated reservations for one account.
    pub fn get_reservations_for_account(
        &self,
        account_id: AccountId,
        from: u32,
        limit: u32,
    ) -> Vec<ReservationView> {
        let ids = self
            .account_events
            .get(&account_id)
            .cloned()
            .unwrap_or_default();
        let limit = limit.min(MAX_PAGE) as usize;
        ids.iter()
            .skip(from as usize)
            .take(limit)
            .filter_map(|id| self.reservations.get(&(*id, account_id.clone())))
            .map(Self::reservation_view)
            .collect()
    }

    /// Bounded attendance history (checked-in reservations only).
    pub fn get_attendance_history(
        &self,
        account_id: AccountId,
        from: u32,
        limit: u32,
    ) -> Vec<ReservationView> {
        let ids = self
            .account_events
            .get(&account_id)
            .cloned()
            .unwrap_or_default();
        let limit = limit.min(MAX_PAGE) as usize;
        ids.iter()
            .skip(from as usize)
            .take(limit)
            .filter_map(|id| self.reservations.get(&(*id, account_id.clone())))
            .filter(|reservation| reservation.checked_in)
            .map(Self::reservation_view)
            .collect()
    }

    pub fn get_treasury_balance(&self) -> U128 {
        U128::from(self.treasury_accrued)
    }

    pub fn get_total_liability(&self) -> U128 {
        U128::from(self.total_liability)
    }

    pub fn get_pending_amount(&self) -> U128 {
        U128::from(self.pending_total)
    }

    pub fn get_storage_stake(&self) -> U128 {
        U128::from(self.storage_stake())
    }

    pub fn get_required_balance(&self) -> U128 {
        U128::from(self.required_balance())
    }

    pub fn get_surplus(&self) -> U128 {
        U128::from(
            env::account_balance()
                .as_yoctonear()
                .saturating_sub(self.required_balance()),
        )
    }

    pub fn get_last_storage_delta(&self) -> u64 {
        self.last_storage_delta
    }

    pub fn get_max_record_bytes(&self) -> u64 {
        self.max_record_bytes
    }

    pub fn get_treasury_account(&self) -> AccountId {
        self.treasury.clone()
    }

    pub fn get_network_id(&self) -> String {
        self.network_id.clone()
    }
}

/// Canonical ticket commitment:
/// `SHA256("GatherBond:v1" || len(network) || network || len(contract) || contract
///         || event_id_le || len(attendee) || attendee || len(secret) || secret)`
/// where `len(..)` is a little-endian `u32` byte length.
///
/// The same encoding must be reproduced by the frontend. Known-answer vectors live in
/// `docs/ticket-commitment-vectors.json`; this helper is executed against them by
/// `test_ticket_commitment_known_answer_vectors`, and the frontend implementation by
/// `scripts/verify-ticket-commitment.mjs`. Public so tests and tooling can call it; it is
/// deliberately not a contract method and must never be exposed as one.
pub fn ticket_commitment(
    network_id: &str,
    contract_id: &AccountId,
    event_id: u64,
    attendee: &AccountId,
    secret: &str,
) -> [u8; 32] {
    let mut buf = Vec::with_capacity(192);
    buf.extend_from_slice(COMMITMENT_DOMAIN);
    push_bytes(&mut buf, network_id.as_bytes());
    push_bytes(&mut buf, contract_id.as_str().as_bytes());
    buf.extend_from_slice(&event_id.to_le_bytes());
    push_bytes(&mut buf, attendee.as_str().as_bytes());
    push_bytes(&mut buf, secret.as_bytes());

    let digest = env::sha256(&buf);
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

fn push_bytes(buf: &mut Vec<u8>, bytes: &[u8]) {
    buf.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    buf.extend_from_slice(bytes);
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, Gas, NearToken};

    const BYTE_COST: u128 = 10_000_000_000_000_000_000;
    const BUFFER_MIN: u128 = 1_000_000_000_000_000_000_000;
    const BASE_USAGE: u64 = 1_024;
    const DEPOSIT: u128 = 1_000_000_000_000_000_000_000_000; // 1 NEAR
    const CAPACITY: u32 = 10;
    const NETWORK: &str = "testnet";
    const SECRET: &str = "s3cret-ticket-0001";
    const EVENT_STORAGE: NearToken = NearToken::from_millinear(50);

    const T0: u64 = 1_700_000_000; // seconds
    const START: u64 = T0 + 3_600;
    const END: u64 = T0 + 7_200;
    const REG_DEADLINE: u64 = T0 + 1_800;
    const CHECKIN_OPEN: u64 = REG_DEADLINE;
    const CHECKIN_CLOSE: u64 = END;

    fn ns(secs: u64) -> u64 {
        secs * 1_000_000_000
    }

    fn zero() -> NearToken {
        NearToken::from_yoctonear(0)
    }

    fn acct(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn organizer() -> AccountId {
        acct("organizer.testnet")
    }

    fn alice() -> AccountId {
        acct("alice.testnet")
    }

    fn bob() -> AccountId {
        acct("bob.the.longer.testnet")
    }

    fn treasury() -> AccountId {
        acct("treasury.testnet")
    }

    fn contract_account() -> AccountId {
        acct("contract.testnet")
    }

    struct Chain {
        balance: u128,
        usage: u64,
        now: u64,
        gas: Gas,
    }

    impl Chain {
        fn new() -> Self {
            Self {
                balance: 0,
                usage: BASE_USAGE,
                now: ns(T0),
                gas: Gas::from_tgas(300),
            }
        }

        fn enter(&self, predecessor: &AccountId, attached: NearToken) {
            testing_env!(VMContextBuilder::new()
                .current_account_id(contract_account())
                .predecessor_account_id(predecessor.clone())
                .account_balance(NearToken::from_yoctonear(self.balance))
                .storage_usage(self.usage)
                .block_timestamp(self.now)
                .prepaid_gas(self.gas)
                .attached_deposit(attached)
                .build());
        }

        fn credit(&mut self, amount: NearToken) {
            self.balance = self.balance.checked_add(amount.as_yoctonear()).unwrap();
        }
    }

    fn stake(usage: u64) -> u128 {
        u128::from(usage) * BYTE_COST
    }

    fn buffer(usage: u64) -> u128 {
        (stake(usage) / 20).max(BUFFER_MIN)
    }

    fn required(contract: &GatherBond, usage: u64) -> u128 {
        contract.total_liability + contract.pending_total + stake(usage) + buffer(usage)
    }

    fn assert_invariant(contract: &GatherBond, chain: &Chain) {
        let needed = required(contract, chain.usage);
        assert!(
            chain.balance >= needed,
            "invariant violated: balance {} < required {}",
            chain.balance,
            needed
        );
    }

    fn init() -> (GatherBond, Chain) {
        let mut chain = Chain::new();
        let reserve = NearToken::from_millinear(100);
        chain.balance = reserve.as_yoctonear();
        chain.enter(&organizer(), reserve);
        let contract = GatherBond::new(treasury(), NETWORK.to_string());
        (contract, chain)
    }

    fn commitment(event_id: u64, attendee: &AccountId, secret: &str) -> [u8; 32] {
        ticket_commitment(NETWORK, &contract_account(), event_id, attendee, secret)
    }

    fn create(contract: &mut GatherBond, chain: &mut Chain) -> u64 {
        chain.enter(&organizer(), EVENT_STORAGE);
        let id = contract
            .create_event(
                U128::from(DEPOSIT),
                CAPACITY,
                U64::from(ns(START)),
                U64::from(ns(END)),
                U64::from(ns(REG_DEADLINE)),
                U64::from(ns(CHECKIN_OPEN)),
                U64::from(ns(CHECKIN_CLOSE)),
                [7u8; 32],
            )
            .0;
        chain.credit(EVENT_STORAGE);
        chain.usage += contract.last_storage_delta;
        id
    }

    fn register(contract: &mut GatherBond, chain: &mut Chain, who: &AccountId, event_id: u64) {
        chain.enter(who, NearToken::from_yoctonear(DEPOSIT));
        contract.register(U64::from(event_id), commitment(event_id, who, SECRET));
        chain.credit(NearToken::from_yoctonear(DEPOSIT));
        chain.usage += contract.last_storage_delta;
    }

    fn check_in(contract: &mut GatherBond, chain: &mut Chain, who: &AccountId, event_id: u64) {
        chain.enter(&organizer(), zero());
        contract.check_in(U64::from(event_id), who.clone(), SECRET.to_string());
    }

    fn check_in_with_secret(
        contract: &mut GatherBond,
        chain: &mut Chain,
        who: &AccountId,
        event_id: u64,
        secret: &str,
    ) {
        chain.enter(&organizer(), zero());
        contract.check_in(U64::from(event_id), who.clone(), secret.to_string());
    }

    fn rotate(
        contract: &mut GatherBond,
        chain: &mut Chain,
        who: &AccountId,
        event_id: u64,
        secret: &str,
    ) {
        chain.enter(who, zero());
        contract.rotate_ticket_commitment(U64::from(event_id), commitment(event_id, who, secret));
    }

    fn finalize(contract: &mut GatherBond, chain: &mut Chain, event_id: u64) {
        chain.now = ns(END) + 1;
        chain.enter(&alice(), zero());
        contract.finalize_event(U64::from(event_id));
    }

    fn cancel(contract: &mut GatherBond, chain: &mut Chain, event_id: u64) {
        chain.enter(&organizer(), zero());
        contract.cancel_event(U64::from(event_id));
    }

    fn claim(contract: &mut GatherBond, chain: &mut Chain, who: &AccountId, event_id: u64) {
        chain.enter(who, zero());
        let promise = contract.claim_settlement(U64::from(event_id));
        let _ = promise.detach();
    }

    fn settle_ok(contract: &mut GatherBond, chain: &mut Chain, who: &AccountId, event_id: u64) {
        let event = contract.events.get(&event_id).cloned().unwrap();
        let amount = event.lock_amount;
        chain.balance = chain.balance.checked_sub(amount).unwrap();
        chain.enter(&contract_account(), zero());
        assert!(contract.on_claim_callback(Ok(()), event_id, who.clone(), event.lock_nonce));
    }

    fn settle_fail(contract: &mut GatherBond, chain: &mut Chain, who: &AccountId, event_id: u64) {
        let event = contract.events.get(&event_id).cloned().unwrap();
        chain.enter(&contract_account(), zero());
        assert!(!contract.on_claim_callback(
            Err(PromiseError::Failed),
            event_id,
            who.clone(),
            event.lock_nonce
        ));
    }

    /// Sum of every event pool plus accrued treasury; must equal `total_liability`.
    fn pool_sum(contract: &GatherBond) -> u128 {
        let mut sum = contract.treasury_accrued;
        for id in 0..contract.next_event_id {
            if let Some(event) = contract.events.get(&id) {
                sum += event.refund_pool + event.reward_pool;
            }
        }
        sum
    }

    #[test]
    fn test_initialization() {
        let (contract, chain) = init();
        assert_eq!(contract.get_treasury_account(), treasury());
        assert_eq!(contract.get_network_id(), NETWORK);
        assert_eq!(contract.get_event_count().0, 0);
        assert_eq!(contract.get_total_liability().0, 0);
        assert_eq!(contract.get_pending_amount().0, 0);
        assert!(!contract.treasury_lock);
        assert_invariant(&contract, &chain);
    }

    #[test]
    fn test_create_event_valid() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        assert_eq!(id, 0);

        let event = contract.get_event(U64::from(id)).unwrap();
        assert_eq!(event.organizer, organizer());
        assert_eq!(event.deposit.0, DEPOSIT);
        assert_eq!(event.capacity, CAPACITY);
        assert_eq!(event.status, EventStatus::Open);
        assert_eq!(event.refund_pool.0, 0);
        assert_invariant(&contract, &chain);
    }

    #[test]
    #[should_panic(expected = "Check-in must open after registration closes")]
    fn test_create_event_rejects_invalid_checkin_window() {
        let (mut contract, chain) = init();
        chain.enter(&organizer(), EVENT_STORAGE);
        contract.create_event(
            U128::from(DEPOSIT),
            CAPACITY,
            U64::from(ns(START)),
            U64::from(ns(END)),
            U64::from(ns(REG_DEADLINE)),
            U64::from(ns(END)),
            U64::from(ns(END) + 1),
            [7u8; 32],
        );
    }

    #[test]
    fn test_create_event_accepts_checkin_before_start() {
        let (mut contract, chain) = init();
        chain.enter(&organizer(), EVENT_STORAGE);
        contract.create_event(
            U128::from(DEPOSIT),
            CAPACITY,
            U64::from(ns(START)),
            U64::from(ns(END)),
            U64::from(ns(REG_DEADLINE)),
            U64::from(ns(REG_DEADLINE)),
            U64::from(ns(START)),
            [7u8; 32],
        );
        let event = contract.get_event(U64::from(0)).unwrap();
        assert_eq!(event.checkin_open.0, ns(REG_DEADLINE));
        assert_eq!(event.checkin_close.0, ns(START));
    }

    #[test]
    #[should_panic(expected = "Check-in must open after registration closes")]
    fn test_create_event_rejects_checkin_before_registration_closes() {
        let (mut contract, chain) = init();
        chain.enter(&organizer(), EVENT_STORAGE);
        contract.create_event(
            U128::from(DEPOSIT),
            CAPACITY,
            U64::from(ns(START)),
            U64::from(ns(END)),
            U64::from(ns(REG_DEADLINE)),
            U64::from(ns(REG_DEADLINE) - 1),
            U64::from(ns(START)),
            [7u8; 32],
        );
    }

    #[test]
    #[should_panic(expected = "Deposit must be greater than zero")]
    fn test_create_event_rejects_zero_deposit() {
        let (mut contract, chain) = init();
        chain.enter(&organizer(), EVENT_STORAGE);
        contract.create_event(
            U128::from(0),
            CAPACITY,
            U64::from(ns(START)),
            U64::from(ns(END)),
            U64::from(ns(REG_DEADLINE)),
            U64::from(ns(CHECKIN_OPEN)),
            U64::from(ns(CHECKIN_CLOSE)),
            [7u8; 32],
        );
    }

    #[test]
    #[should_panic(expected = "Event storage contribution")]
    fn test_create_event_requires_storage_contribution() {
        let (mut contract, chain) = init();
        chain.enter(&organizer(), NearToken::from_yoctonear(1));
        contract.create_event(
            U128::from(DEPOSIT),
            CAPACITY,
            U64::from(ns(START)),
            U64::from(ns(END)),
            U64::from(ns(REG_DEADLINE)),
            U64::from(ns(CHECKIN_OPEN)),
            U64::from(ns(CHECKIN_CLOSE)),
            [7u8; 32],
        );
    }

    #[test]
    fn test_register_success() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);

        let event = contract.events.get(&id).unwrap();
        assert_eq!(event.registered, 1);
        assert_eq!(event.refund_pool, DEPOSIT);
        assert_eq!(contract.get_total_liability().0, DEPOSIT);

        let reservation = contract.get_reservation(U64::from(id), alice()).unwrap();
        assert_eq!(reservation.deposit.0, DEPOSIT);
        assert!(!reservation.checked_in);
        assert_eq!(reservation.claim, ClaimStatus::Unclaimed);
        assert_invariant(&contract, &chain);
    }

    #[test]
    #[should_panic(expected = "Exact deposit required")]
    fn test_register_rejects_wrong_amount() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        chain.enter(&alice(), NearToken::from_millinear(500));
        contract.register(U64::from(id), commitment(id, &alice(), SECRET));
    }

    #[test]
    #[should_panic(expected = "Already registered")]
    fn test_register_rejects_duplicate() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        register(&mut contract, &mut chain, &alice(), id);
    }

    #[test]
    #[should_panic(expected = "Registration deadline has passed")]
    fn test_register_rejects_after_deadline() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        chain.now = ns(REG_DEADLINE) + 1;
        chain.enter(&alice(), NearToken::from_yoctonear(DEPOSIT));
        contract.register(U64::from(id), commitment(id, &alice(), SECRET));
    }

    #[test]
    #[should_panic(expected = "Event capacity is full")]
    fn test_register_rejects_at_capacity() {
        let (mut contract, mut chain) = init();
        chain.enter(&organizer(), EVENT_STORAGE);
        let id = contract
            .create_event(
                U128::from(DEPOSIT),
                1,
                U64::from(ns(START)),
                U64::from(ns(END)),
                U64::from(ns(REG_DEADLINE)),
                U64::from(ns(CHECKIN_OPEN)),
                U64::from(ns(CHECKIN_CLOSE)),
                [7u8; 32],
            )
            .0;
        chain.credit(EVENT_STORAGE);
        chain.usage += contract.last_storage_delta;

        register(&mut contract, &mut chain, &alice(), id);
        register(&mut contract, &mut chain, &bob(), id);
    }

    #[test]
    fn test_check_in_success() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        chain.now = ns(START) + 10;
        check_in(&mut contract, &mut chain, &alice(), id);

        let reservation = contract.get_reservation(U64::from(id), alice()).unwrap();
        assert!(reservation.checked_in);
        assert_eq!(reservation.checked_in_at.0, ns(START) + 10);
        assert_eq!(contract.events.get(&id).unwrap().checked_in, 1);
    }

    #[test]
    fn test_check_in_allows_early_arrival() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        chain.now = ns(REG_DEADLINE) + 1;
        check_in(&mut contract, &mut chain, &alice(), id);

        let reservation = contract.get_reservation(U64::from(id), alice()).unwrap();
        assert!(reservation.checked_in);
        assert_eq!(reservation.checked_in_at.0, ns(REG_DEADLINE) + 1);
        assert_eq!(contract.events.get(&id).unwrap().checked_in, 1);
    }

    #[test]
    #[should_panic(expected = "Invalid ticket")]
    fn test_check_in_rejects_wrong_secret() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        chain.now = ns(START) + 10;
        chain.enter(&organizer(), zero());
        contract.check_in(U64::from(id), alice(), "wrong-secret".to_string());
    }

    #[test]
    #[should_panic(expected = "Ticket already used")]
    fn test_check_in_rejects_replay() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        chain.now = ns(START) + 10;
        check_in(&mut contract, &mut chain, &alice(), id);
        check_in(&mut contract, &mut chain, &alice(), id);
    }

    #[test]
    #[should_panic(expected = "Only the event organizer")]
    fn test_check_in_rejects_non_organizer() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        chain.now = ns(START) + 10;
        chain.enter(&alice(), zero());
        contract.check_in(U64::from(id), alice(), SECRET.to_string());
    }

    #[test]
    #[should_panic(expected = "Check-in window is closed")]
    fn test_check_in_rejects_outside_window() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        chain.enter(&organizer(), zero());
        contract.check_in(U64::from(id), alice(), SECRET.to_string());
    }

    #[test]
    fn test_rotate_ticket_commitment_replaces_ticket() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        let before = contract.get_event(U64::from(id)).unwrap();
        let liability = contract.get_total_liability().0;

        chain.now = ns(REG_DEADLINE) + 1;
        rotate(
            &mut contract,
            &mut chain,
            &alice(),
            id,
            "recovered-ticket-0002",
        );

        let after = contract.get_event(U64::from(id)).unwrap();
        assert_eq!(after.registered, before.registered);
        assert_eq!(after.checked_in, before.checked_in);
        assert_eq!(after.refund_pool, before.refund_pool);
        assert_eq!(after.reward_pool, before.reward_pool);
        assert_eq!(contract.get_total_liability().0, liability);

        chain.now = ns(START) + 10;
        check_in_with_secret(
            &mut contract,
            &mut chain,
            &alice(),
            id,
            "recovered-ticket-0002",
        );
        assert!(
            contract
                .get_reservation(U64::from(id), alice())
                .unwrap()
                .checked_in
        );
        assert_eq!(contract.events.get(&id).unwrap().checked_in, 1);
        assert_invariant(&contract, &chain);
    }

    #[test]
    #[should_panic(expected = "Invalid ticket")]
    fn test_rotate_ticket_commitment_invalidates_old_secret() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        chain.now = ns(REG_DEADLINE) + 1;
        rotate(
            &mut contract,
            &mut chain,
            &alice(),
            id,
            "recovered-ticket-0002",
        );

        chain.now = ns(START) + 10;
        check_in_with_secret(&mut contract, &mut chain, &alice(), id, SECRET);
    }

    #[test]
    fn test_rotate_ticket_commitment_allowed_before_checkin_opens() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);

        // Recovery must be possible before the door opens, not only during the window.
        chain.now = ns(T0);
        rotate(
            &mut contract,
            &mut chain,
            &alice(),
            id,
            "recovered-early-0003",
        );

        chain.now = ns(START) + 10;
        check_in_with_secret(
            &mut contract,
            &mut chain,
            &alice(),
            id,
            "recovered-early-0003",
        );
        assert!(
            contract
                .get_reservation(U64::from(id), alice())
                .unwrap()
                .checked_in
        );
    }

    #[test]
    #[should_panic(expected = "No reservation for this attendee")]
    fn test_rotate_ticket_commitment_requires_reservation() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        chain.now = ns(REG_DEADLINE) + 1;
        rotate(&mut contract, &mut chain, &alice(), id, SECRET);
    }

    #[test]
    #[should_panic(expected = "No reservation for this attendee")]
    fn test_rotate_ticket_commitment_is_not_a_shared_ticket_override() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        chain.now = ns(REG_DEADLINE) + 1;
        rotate(&mut contract, &mut chain, &bob(), id, SECRET);
    }

    #[test]
    #[should_panic(expected = "Ticket already used")]
    fn test_rotate_ticket_commitment_rejects_checked_in_ticket() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        chain.now = ns(START) + 10;
        check_in(&mut contract, &mut chain, &alice(), id);
        rotate(
            &mut contract,
            &mut chain,
            &alice(),
            id,
            "late-rotation-0004",
        );
    }

    #[test]
    #[should_panic(expected = "Check-in window is closed")]
    fn test_rotate_ticket_commitment_rejects_after_window() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        chain.now = ns(END) + 1;
        rotate(&mut contract, &mut chain, &alice(), id, "too-late-0005");
    }

    #[test]
    #[should_panic(expected = "Event is not open")]
    fn test_rotate_ticket_commitment_rejects_finalized_event() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        finalize(&mut contract, &mut chain, id);
        rotate(&mut contract, &mut chain, &alice(), id, "finalized-0006");
    }

    #[test]
    #[should_panic(expected = "Event is not open")]
    fn test_rotate_ticket_commitment_rejects_cancelled_event() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        cancel(&mut contract, &mut chain, id);
        rotate(&mut contract, &mut chain, &alice(), id, "cancelled-0007");
    }

    #[test]
    #[should_panic(expected = "Settlement in flight")]
    fn test_rotate_ticket_commitment_rejects_locked_event() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        let mut event = contract.events.get(&id).cloned().unwrap();
        event.lock = true;
        contract.events.insert(id, event);
        chain.now = ns(REG_DEADLINE) + 1;
        rotate(&mut contract, &mut chain, &alice(), id, "locked-0008");
    }

    #[test]
    #[should_panic(expected = "cannot be finalized before it ends")]
    fn test_finalize_rejects_before_end() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        chain.enter(&alice(), zero());
        contract.finalize_event(U64::from(id));
    }

    #[test]
    fn test_settlement_math_partial_attendance() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        register(&mut contract, &mut chain, &bob(), id);
        register(&mut contract, &mut chain, &acct("carol.testnet"), id);

        chain.now = ns(START) + 10;
        check_in(&mut contract, &mut chain, &alice(), id);
        check_in(&mut contract, &mut chain, &bob(), id);

        finalize(&mut contract, &mut chain, id);

        let event = contract.get_event(U64::from(id)).unwrap();
        // pool = 1 * D; A = 2 => reward = D/2, remainder 0.
        assert_eq!(event.reward_per_attendee.0, DEPOSIT / 2);
        assert_eq!(event.refund_pool.0, 2 * DEPOSIT);
        assert_eq!(event.reward_pool.0, DEPOSIT);
        assert_eq!(contract.get_treasury_balance().0, 0);
        assert_eq!(contract.get_total_liability().0, 3 * DEPOSIT);
        assert_eq!(pool_sum(&contract), contract.total_liability);
        assert_invariant(&contract, &chain);

        claim(&mut contract, &mut chain, &alice(), id);
        settle_ok(&mut contract, &mut chain, &alice(), id);
        let alice_reservation = contract.get_reservation(U64::from(id), alice()).unwrap();
        assert_eq!(alice_reservation.claim, ClaimStatus::Claimed);

        claim(&mut contract, &mut chain, &bob(), id);
        settle_ok(&mut contract, &mut chain, &bob(), id);

        assert_eq!(contract.get_total_liability().0, 0);
        assert_eq!(contract.events.get(&id).unwrap().refund_pool, 0);
        assert_eq!(contract.events.get(&id).unwrap().reward_pool, 0);
        assert_invariant(&contract, &chain);
    }

    #[test]
    #[should_panic(expected = "No refund or reward")]
    fn test_no_show_cannot_claim() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        register(&mut contract, &mut chain, &bob(), id);

        chain.now = ns(START) + 10;
        check_in(&mut contract, &mut chain, &alice(), id);
        finalize(&mut contract, &mut chain, id);

        // Bob never checked in.
        claim(&mut contract, &mut chain, &bob(), id);
    }

    #[test]
    #[should_panic(expected = "Reservation is not claimable")]
    fn test_double_claim_reverts() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        chain.now = ns(START) + 10;
        check_in(&mut contract, &mut chain, &alice(), id);
        finalize(&mut contract, &mut chain, id);

        claim(&mut contract, &mut chain, &alice(), id);
        settle_ok(&mut contract, &mut chain, &alice(), id);
        claim(&mut contract, &mut chain, &alice(), id);
    }

    #[test]
    fn test_callback_failure_restores_entitlement() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        chain.now = ns(START) + 10;
        check_in(&mut contract, &mut chain, &alice(), id);
        finalize(&mut contract, &mut chain, id);

        let before = contract.events.get(&id).cloned().unwrap();
        claim(&mut contract, &mut chain, &alice(), id);
        assert!(contract.events.get(&id).unwrap().lock);
        settle_fail(&mut contract, &mut chain, &alice(), id);

        let after = contract.events.get(&id).cloned().unwrap();
        assert_eq!(after.refund_pool, before.refund_pool);
        assert_eq!(after.reward_pool, before.reward_pool);
        assert!(!after.lock);
        assert_eq!(
            contract
                .get_reservation(U64::from(id), alice())
                .unwrap()
                .claim,
            ClaimStatus::Unclaimed
        );
        assert_eq!(contract.get_pending_amount().0, 0);
        assert_invariant(&contract, &chain);

        // Retry works.
        claim(&mut contract, &mut chain, &alice(), id);
        settle_ok(&mut contract, &mut chain, &alice(), id);
        assert_eq!(
            contract
                .get_reservation(U64::from(id), alice())
                .unwrap()
                .claim,
            ClaimStatus::Claimed
        );
    }

    #[test]
    fn test_callback_twice_is_idempotent() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        chain.now = ns(START) + 10;
        check_in(&mut contract, &mut chain, &alice(), id);
        finalize(&mut contract, &mut chain, id);

        claim(&mut contract, &mut chain, &alice(), id);
        settle_ok(&mut contract, &mut chain, &alice(), id);

        let nonce = contract.events.get(&id).unwrap().lock_nonce;
        chain.enter(&contract_account(), zero());
        assert!(!contract.on_claim_callback(Ok(()), id, alice(), nonce));
        assert_eq!(contract.get_pending_amount().0, 0);
        assert_invariant(&contract, &chain);
    }

    #[test]
    #[should_panic(expected = "Settlement in flight")]
    fn test_event_lock_blocks_second_claim() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        register(&mut contract, &mut chain, &bob(), id);
        chain.now = ns(START) + 10;
        check_in(&mut contract, &mut chain, &alice(), id);
        check_in(&mut contract, &mut chain, &bob(), id);
        finalize(&mut contract, &mut chain, id);

        // Alice's payout holds the only lock this event has.
        claim(&mut contract, &mut chain, &alice(), id);
        claim(&mut contract, &mut chain, &bob(), id);
    }

    #[test]
    fn test_lock_is_per_event() {
        let (mut contract, mut chain) = init();
        let first = create(&mut contract, &mut chain);
        let second = create(&mut contract, &mut chain);

        register(&mut contract, &mut chain, &alice(), first);
        register(&mut contract, &mut chain, &bob(), second);

        chain.now = ns(START) + 10;
        check_in(&mut contract, &mut chain, &alice(), first);
        check_in(&mut contract, &mut chain, &bob(), second);
        finalize(&mut contract, &mut chain, first);
        finalize(&mut contract, &mut chain, second);

        claim(&mut contract, &mut chain, &alice(), first);
        // A payout on `first` must not block `second`.
        claim(&mut contract, &mut chain, &bob(), second);
        assert!(contract.events.get(&first).unwrap().lock);
        assert!(contract.events.get(&second).unwrap().lock);
        assert_eq!(contract.get_pending_amount().0, 2 * DEPOSIT);

        settle_ok(&mut contract, &mut chain, &alice(), first);
        settle_ok(&mut contract, &mut chain, &bob(), second);
        assert_eq!(contract.get_pending_amount().0, 0);
        assert_invariant(&contract, &chain);
    }

    #[test]
    fn test_cancel_refunds_everyone() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        register(&mut contract, &mut chain, &bob(), id);

        cancel(&mut contract, &mut chain, id);
        assert_eq!(
            contract.get_event(U64::from(id)).unwrap().status,
            EventStatus::Cancelled
        );

        claim(&mut contract, &mut chain, &alice(), id);
        settle_ok(&mut contract, &mut chain, &alice(), id);
        claim(&mut contract, &mut chain, &bob(), id);
        settle_ok(&mut contract, &mut chain, &bob(), id);

        assert_eq!(contract.get_total_liability().0, 0);
        assert_eq!(contract.events.get(&id).unwrap().refund_pool, 0);
        assert_invariant(&contract, &chain);
    }

    #[test]
    #[should_panic(expected = "Only the event organizer")]
    fn test_cancel_requires_organizer() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        chain.enter(&alice(), zero());
        contract.cancel_event(U64::from(id));
    }

    #[test]
    fn test_all_no_show_accrues_treasury() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        register(&mut contract, &mut chain, &bob(), id);

        finalize(&mut contract, &mut chain, id);

        assert_eq!(contract.get_treasury_balance().0, 2 * DEPOSIT);
        assert_eq!(contract.events.get(&id).unwrap().refund_pool, 0);
        assert_eq!(contract.events.get(&id).unwrap().reward_pool, 0);
        assert_eq!(contract.get_total_liability().0, 2 * DEPOSIT);
        assert_eq!(pool_sum(&contract), contract.total_liability);
        assert_invariant(&contract, &chain);
    }

    #[test]
    fn test_rounding_remainder_accrues_to_treasury() {
        let (mut contract, mut chain) = init();
        // 3 registered, 2 attended, deposit 7 yocto => pool 7, reward 3, remainder 1.
        chain.enter(&organizer(), EVENT_STORAGE);
        let id = contract
            .create_event(
                U128::from(7u128),
                3,
                U64::from(ns(START)),
                U64::from(ns(END)),
                U64::from(ns(REG_DEADLINE)),
                U64::from(ns(CHECKIN_OPEN)),
                U64::from(ns(CHECKIN_CLOSE)),
                [9u8; 32],
            )
            .0;
        chain.credit(EVENT_STORAGE);
        chain.usage += contract.last_storage_delta;

        for who in [alice(), bob(), acct("carol.testnet")] {
            chain.enter(&who, NearToken::from_yoctonear(7));
            contract.register(U64::from(id), commitment(id, &who, SECRET));
            chain.credit(NearToken::from_yoctonear(7));
            chain.usage += contract.last_storage_delta;
        }

        chain.now = ns(START) + 10;
        check_in(&mut contract, &mut chain, &alice(), id);
        check_in(&mut contract, &mut chain, &bob(), id);
        finalize(&mut contract, &mut chain, id);

        let event = contract.get_event(U64::from(id)).unwrap();
        assert_eq!(event.reward_per_attendee.0, 3);
        assert_eq!(event.reward_pool.0, 6);
        assert_eq!(event.refund_pool.0, 14);
        assert_eq!(contract.get_treasury_balance().0, 1);
        assert_eq!(pool_sum(&contract), contract.total_liability);
        assert_invariant(&contract, &chain);
    }

    #[test]
    fn test_treasury_withdrawal_bounded_and_settled() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        register(&mut contract, &mut chain, &bob(), id);
        finalize(&mut contract, &mut chain, id);
        assert_eq!(contract.get_treasury_balance().0, 2 * DEPOSIT);

        chain.enter(&treasury(), zero());
        let promise = contract.withdraw_treasury(U128::from(2 * DEPOSIT));
        let _ = promise.detach();
        assert!(contract.treasury_lock);
        assert_eq!(contract.get_treasury_balance().0, 0);
        assert_eq!(contract.get_pending_amount().0, 2 * DEPOSIT);

        // Transfer executes, then the callback confirms.
        chain.balance -= 2 * DEPOSIT;
        let nonce = contract.treasury_nonce;
        chain.enter(&contract_account(), zero());
        assert!(contract.on_treasury_callback(Ok(()), nonce));
        assert!(!contract.treasury_lock);
        assert_eq!(contract.get_pending_amount().0, 0);
        assert_invariant(&contract, &chain);
    }

    #[test]
    fn test_treasury_withdrawal_failure_restores_balance() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        finalize(&mut contract, &mut chain, id);

        let accrued = contract.get_treasury_balance().0;
        chain.enter(&treasury(), zero());
        let _ = contract.withdraw_treasury(U128::from(accrued)).detach();

        let nonce = contract.treasury_nonce;
        chain.enter(&contract_account(), zero());
        assert!(!contract.on_treasury_callback(Err(PromiseError::Failed), nonce));
        assert_eq!(contract.get_treasury_balance().0, accrued);
        assert_eq!(contract.get_pending_amount().0, 0);
        assert_invariant(&contract, &chain);
    }

    #[test]
    #[should_panic(expected = "exceeds accrued treasury")]
    fn test_treasury_cannot_touch_attendee_liabilities() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        chain.now = ns(START) + 10;
        check_in(&mut contract, &mut chain, &alice(), id);
        finalize(&mut contract, &mut chain, id);

        // Pool for the single attendee is D; treasury is empty.
        chain.enter(&treasury(), zero());
        let _ = contract.withdraw_treasury(U128::from(DEPOSIT)).detach();
    }

    #[test]
    fn test_storage_delta_is_measured() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        assert!(contract.get_last_storage_delta() > 0);

        register(&mut contract, &mut chain, &alice(), id);
        let short = contract.get_last_storage_delta();
        register(&mut contract, &mut chain, &bob(), id);
        let long = contract.get_last_storage_delta();

        // The delta is measured, so it must grow with the account id length instead
        // of being a constant estimate.
        assert!(long > short);
    }

    #[test]
    fn test_ticket_commitment_known_answer_vectors() {
        fn to_hex(bytes: &[u8]) -> String {
            use std::fmt::Write;
            let mut out = String::with_capacity(bytes.len() * 2);
            for byte in bytes {
                write!(out, "{byte:02x}").expect("write to string");
            }
            out
        }

        let document = include_str!("../../docs/ticket-commitment-vectors.json");
        let parsed: near_sdk::serde_json::Value =
            near_sdk::serde_json::from_str(document).expect("valid vectors json");
        let vectors = parsed["vectors"].as_array().expect("vectors array");
        assert!(vectors.len() >= 8, "expected at least 8 vectors");

        for vector in vectors {
            let name = vector["name"].as_str().expect("name");
            let network = vector["network_id"].as_str().expect("network_id");
            let contract_id: AccountId = vector["contract_id"]
                .as_str()
                .expect("contract_id")
                .parse()
                .expect("valid contract id");
            let event_id: u64 = vector["event_id"]
                .as_str()
                .expect("event_id string")
                .parse()
                .expect("valid event id");
            let attendee: AccountId = vector["attendee"]
                .as_str()
                .expect("attendee")
                .parse()
                .expect("valid attendee");
            let secret = vector["secret"].as_str().expect("secret");
            let expected = vector["digest_hex"].as_str().expect("digest_hex");

            let digest = ticket_commitment(network, &contract_id, event_id, &attendee, secret);
            let actual = to_hex(&digest);
            println!("ok   {name:<24} {actual}");
            assert_eq!(actual, expected, "commitment vector {name}");
        }
    }

    #[test]
    fn test_pagination_is_bounded() {
        let (mut contract, mut chain) = init();
        for _ in 0..3 {
            create(&mut contract, &mut chain);
        }
        assert_eq!(contract.get_events(U64::from(0), 2).len(), 2);
        assert_eq!(contract.get_events(U64::from(1), 10).len(), 2);
        assert_eq!(contract.get_events(U64::from(3), 10).len(), 0);
        // Limit is clamped, never unbounded.
        assert!(contract.get_events(U64::from(0), 1_000).len() <= MAX_PAGE as usize);

        let id = 0;
        register(&mut contract, &mut chain, &alice(), id);
        assert_eq!(
            contract.get_reservations_for_account(alice(), 0, 10).len(),
            1
        );
        assert_eq!(contract.get_attendance_history(alice(), 0, 10).len(), 0);
    }

    #[test]
    #[should_panic(expected = "Insufficient prepaid gas")]
    fn test_claim_requires_callback_gas() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        chain.now = ns(START) + 10;
        check_in(&mut contract, &mut chain, &alice(), id);
        finalize(&mut contract, &mut chain, id);

        chain.gas = Gas::from_tgas(10);
        claim(&mut contract, &mut chain, &alice(), id);
    }

    #[test]
    fn test_liability_identity_across_lifecycle() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);
        register(&mut contract, &mut chain, &bob(), id);

        assert_eq!(pool_sum(&contract), contract.total_liability);

        chain.now = ns(START) + 10;
        check_in(&mut contract, &mut chain, &alice(), id);
        assert_eq!(pool_sum(&contract), contract.total_liability);

        finalize(&mut contract, &mut chain, id);
        assert_eq!(pool_sum(&contract), contract.total_liability);
        claim(&mut contract, &mut chain, &alice(), id);
        // The claim moved value out of the pool into `pending_total`, so the pool sum
        // still equals the liability total and pending is tracked separately.
        assert_eq!(pool_sum(&contract), contract.total_liability);
        assert!(contract.pending_total > 0);

        settle_ok(&mut contract, &mut chain, &alice(), id);
        assert_eq!(pool_sum(&contract), contract.total_liability);
        assert_invariant(&contract, &chain);
    }

    #[test]
    #[should_panic(expected = "No reservation for caller")]
    fn test_claim_requires_reservation() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        finalize(&mut contract, &mut chain, id);
        claim(&mut contract, &mut chain, &alice(), id);
    }

    #[test]
    fn test_views_expose_public_fields() {
        let (mut contract, mut chain) = init();
        let id = create(&mut contract, &mut chain);
        register(&mut contract, &mut chain, &alice(), id);

        let event = contract.get_event(U64::from(id)).unwrap();
        assert_eq!(event.registered, 1);
        assert!(!event.locked);
        assert_eq!(event.metadata_hash, [7u8; 32]);

        let reservation = contract
            .get_reservation(U64::from(id), alice())
            .expect("reservation");
        assert_eq!(reservation.attendee, alice());

        assert!(contract.get_reservation(U64::from(id), bob()).is_none());
    }
}
