import React, { useState, useEffect } from 'react';
import './LimitModal.css';

function getTimeRemaining(endTime) {
  const total = Date.parse(endTime) - Date.parse(new Date());
  const seconds = Math.floor((total / 1000) % 60);
  const minutes = Math.floor((total / 1000 / 60) % 60);
  const hours = Math.floor((total / (1000 * 60 * 60)) % 24);

  return {
    total,
    hours,
    minutes,
    seconds,
  };
}

function LimitModal({ isOpen, onClose, resetsAt }) {
  const [timeRemaining, setTimeRemaining] = useState(getTimeRemaining(resetsAt));

  useEffect(() => {
    if (isOpen) {
      const timer = setInterval(() => {
        setTimeRemaining(getTimeRemaining(resetsAt));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [isOpen, resetsAt]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <button className="modal-close" onClick={onClose}>&times;</button>
        <h2>Limit Reached</h2>
        <p>This surpasses your daily amount of song requests, we are working on a subscription to increase the amount of song requests.</p>
        {timeRemaining.total > 0 ? (
          <div className="countdown">
            Song requests will reset in: <strong>{String(timeRemaining.hours).padStart(2, '0')}:{String(timeRemaining.minutes).padStart(2, '0')}:{String(timeRemaining.seconds).padStart(2, '0')}</strong>
          </div>
        ) : (
          <div className="countdown">
            Your song requests should be reset. Please refresh the page.
          </div>
        )}
      </div>
    </div>
  );
}

export default LimitModal;
