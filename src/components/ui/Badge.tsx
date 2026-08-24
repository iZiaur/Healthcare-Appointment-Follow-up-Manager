import React from 'react';

type BadgeProps = {
  children: React.ReactNode;
  variant?: 'high' | 'medium' | 'low' | 'pending' | 'failed' | 'success' | 'default';
  className?: string;
};

export const Badge: React.FC<BadgeProps> = ({ children, variant = 'default', className = '' }) => {
  const variants = {
    high: 'bg-urgency-high-bg text-urgency-high-text',
    medium: 'bg-urgency-medium-bg text-urgency-medium-text',
    low: 'bg-urgency-low-bg text-urgency-low-text',
    pending: 'bg-status-pending-bg text-status-pending-text',
    failed: 'bg-status-failed-bg text-status-failed-text',
    success: 'bg-status-success-bg text-status-success-text',
    default: 'bg-gray-100 text-gray-700'
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-pill text-xs font-medium ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
};
