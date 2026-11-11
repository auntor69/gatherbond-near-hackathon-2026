"use client";

import { useEffect, useRef, useState } from "react";

const SCAN_INTERVAL_MS = 180;

function cameraError(error) {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Camera access needs HTTPS or localhost. Use manual paste below.";
  }
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Camera permission was denied. Use manual paste below, or allow camera access.";
  }
  if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError") {
    return "No usable camera was found. Use manual paste below.";
  }
  return "The camera could not start. Use manual paste below.";
}

export default function QrGate({ onDecode, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const finishedRef = useRef(false);
  const onDecodeRef = useRef(onDecode);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState("starting");
  const [error, setError] = useState("");

  useEffect(() => {
    onDecodeRef.current = onDecode;
  }, [onDecode]);

  useEffect(() => {
    let cancelled = false;
    let detector = null;
    let jsQR = null;
    let canvas = null;
    let context = null;

    function stopCamera() {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    function schedule() {
      if (cancelled || finishedRef.current) return;
      timerRef.current = window.setTimeout(scan, SCAN_INTERVAL_MS);
    }

    async function scan() {
      if (cancelled || finishedRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) {
        schedule();
        return;
      }

      let value = null;
      try {
        if (detector) {
          const codes = await detector.detect(video);
          value = codes?.[0]?.rawValue ?? null;
        } else if (jsQR && canvas && context) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = context.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(frame.data, frame.width, frame.height, {
            inversionAttempts: "attemptBoth",
          });
          value = result?.data ?? null;
        }
      } catch {
        value = null;
      }

      if (value) {
        finishedRef.current = true;
        stopCamera();
        setStatus("scanned");
        navigator.vibrate?.(40);
        onDecodeRef.current?.(value);
        return;
      }
      schedule();
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is not available in this browser");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        throw new Error("The camera preview is not mounted");
      }
      video.srcObject = stream;
      await video.play();
      setStatus("scanning");

      if ("BarcodeDetector" in window) {
        try {
          detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        } catch {
          detector = null;
        }
      }
      if (!detector) {
        const module = await import("jsqr");
        jsQR = module.default ?? module;
      }
      canvas = document.createElement("canvas");
      context = canvas.getContext("2d", { willReadFrequently: true });
      schedule();
    }

    setStatus("starting");
    setError("");
    finishedRef.current = false;
    start().catch((nextError) => {
      if (cancelled) return;
      stopCamera();
      setStatus("error");
      setError(cameraError(nextError));
    });

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [attempt]);

  function restart() {
    setError("");
    setStatus("starting");
    setAttempt((current) => current + 1);
  }

  return (
    <div className="qr-gate">
      <div className="qr-gate-frame">
        <video ref={videoRef} className="qr-gate-video" autoPlay muted playsInline />
        <div className="qr-gate-reticle" aria-hidden="true" />
        <span className="qr-gate-state" role="status">
          {status === "starting"
            ? "Starting camera…"
            : status === "scanning"
              ? "Scanning for a GB1 ticket…"
              : status === "scanned"
                ? "Ticket scanned"
                : "Camera unavailable"}
        </span>
      </div>

      {error ? (
        <p className="qr-gate-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="qr-gate-help">
          Point the camera at the attendee&apos;s QR. A valid scan submits one onchain check-in;
          approve the wallet prompt to finish.
        </p>
      )}

      <div className="action-row action-row--tight">
        {status === "scanned" ? (
          <button type="button" className="button button-dark button-small" onClick={restart}>
            Scan next ticket
          </button>
        ) : null}
        <button type="button" className="button button-ghost button-small" onClick={onClose}>
          Close scanner
        </button>
      </div>
    </div>
  );
}
