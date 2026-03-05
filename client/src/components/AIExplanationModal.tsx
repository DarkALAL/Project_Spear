// client/src/components/AIExplanationModal.tsx
import React, { useEffect, useRef } from 'react';

// ─────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────

interface AIExplanationModalProps {
  explanation: string;
  isLoading: boolean;
  onClose: () => void;
}

// ─────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────

const AIExplanationModal: React.FC<AIExplanationModalProps> = ({
  explanation,
  isLoading,
  onClose,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

  // ── Close on Escape key ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // ── Trap focus inside modal while open ──
  // Prevents tab key from reaching elements behind the backdrop
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    modalRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  // ── Close when clicking outside the modal box ──
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // ─────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────

  return (
    <div
      className="modal-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="AI Assistant Explanation"
    >
      <div
        className="modal-content"
        ref={modalRef}
        tabIndex={-1}
        // Stop clicks inside the modal from bubbling to the backdrop
        onClick={(e) => e.stopPropagation()}
      >

        {/* ── HEADER ── */}
        <div className="modal-header">
          <h3>✨ AI Assistant</h3>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close AI explanation"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* ── BODY ── */}
        <div className="modal-body">
          {isLoading ? (
            // Spinner + text while waiting for the model
            <div className="loader">
              Asking AI model...
            </div>
          ) : explanation ? (
            // Render explanation — preserve whitespace and newlines
            // from the model's output
            <pre className="explanation-text">{explanation}</pre>
          ) : (
            // Fallback if explanation is empty string for some reason
            <p className="no-issues">
              No explanation was returned. Try a different issue.
            </p>
          )}
        </div>

        {/* ── FOOTER ── */}
        <div className="modal-footer">
          <button onClick={onClose} disabled={isLoading}>
            Close
          </button>
        </div>

      </div>
    </div>
  );
};

export default AIExplanationModal;