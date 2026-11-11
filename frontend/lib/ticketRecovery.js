// Owner-authorized ticket recovery.
//
// This generates a fresh secret, rotates the onchain commitment, and only then saves
// the new ticket locally. The old QR/code stops working as soon as the transaction
// lands. No server sees or stores the secret.

import { encodeTicket, newTicketSecret, saveTicket } from "./contract";
import { sendContractCall } from "./nearWallet";
import { ticketCommitmentHex } from "./ticketCommitment.mjs";

export async function recoverTicket({ config, eventId, accountId, title, deposit }) {
  if (!config?.contract_id || !config?.network_id) {
    throw new Error("The contract is not configured on this deployment.");
  }
  if (!accountId) {
    throw new Error("Connect the reservation owner wallet first.");
  }

  const secret = newTicketSecret();
  const commitment = await ticketCommitmentHex({
    networkId: config.network_id,
    contractId: config.contract_id,
    eventId,
    attendee: accountId,
    secret,
  });
  const commitmentArray = Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(commitment.slice(index * 2, index * 2 + 2), 16),
  );

  const call = await sendContractCall({
    contractId: config.contract_id,
    methodName: "rotate_ticket_commitment",
    args: {
      event_id: String(eventId),
      ticket_commitment: commitmentArray,
    },
    deposit: "0",
    gas: "100000000000000",
    expectedAccount: accountId,
  });

  const ticket = {
    v: 1,
    networkId: config.network_id,
    contractId: config.contract_id,
    eventId: String(eventId),
    attendee: accountId,
    secret,
    code: "",
    title: title || `Event ${eventId}`,
    deposit: String(deposit ?? "0"),
    txHash: call.hash,
    createdAt: new Date().toISOString(),
    recoveredAt: new Date().toISOString(),
  };
  ticket.code = encodeTicket(ticket);
  saveTicket(ticket);
  return ticket;
}
