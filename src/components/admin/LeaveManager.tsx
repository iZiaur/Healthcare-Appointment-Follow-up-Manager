'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

type Leave = {
  id: string;
  status: string;
  date: Date;
  isFullDay: boolean;
};

export default function LeaveManager({ leave }: { leave: Leave }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(leave.status);
  
  const handleAction = async (action: 'APPROVE' | 'REJECT') => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaveId: leave.id, action })
      });
      if (!res.ok) throw new Error('Failed');
      setStatus(action === 'APPROVE' ? 'APPROVED' : 'REJECTED');
    } catch (err) {
      alert('Failed to update leave');
    } finally {
      setLoading(false);
    }
  };

  if (status !== 'PENDING') {
    return (
      <Badge variant={status === 'APPROVED' ? 'success' : 'failed'}>
        {status}
      </Badge>
    );
  }

  return (
    <div className="flex space-x-2">
      <Button variant="outline" size="sm" onClick={() => handleAction('REJECT')} isLoading={loading}>Reject</Button>
      <Button variant="primary" size="sm" onClick={() => handleAction('APPROVE')} isLoading={loading}>Approve</Button>
    </div>
  );
}
