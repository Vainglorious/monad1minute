"use client";

import { useEffect } from "react";

interface Props {
  message: string;
  onClose: () => void;
  duration?: number;
}

export default function Toast({ message, onClose, duration = 4500 }: Props) {
  useEffect(() => {
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [onClose, duration]);

  return (
    <div className="toast" role="status" onClick={onClose}>
      <span className="toast-check">✓</span>
      <span>{message}</span>
    </div>
  );
}
