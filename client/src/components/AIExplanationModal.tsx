// client/src/components/AIExplanationModal.tsx
import React from 'react';

interface AIExplanationModalProps {
  explanation: string;
  isLoading: boolean;
  onClose: () => void;
}

const AIExplanationModal: React.FC<AIExplanationModalProps> = ({ explanation, isLoading, onClose }) => {
  return (
    <div className="modal-backdrop">
      <div className="modal-content">
        <h3>AI Assistant Explanation</h3>
        {isLoading ? (
          <div className="loader">Asking AI...</div>
        ) : (
          <pre className="explanation-text">{explanation}</pre>
        )}
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
};

export default AIExplanationModal;