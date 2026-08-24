'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';

export default function PostVisitForm({ appointmentId }: { appointmentId: string }) {
  const [notes, setNotes] = useState('');
  
  // Prescription structure matching Stage 6
  const [hasPrescription, setHasPrescription] = useState(false);
  const [drug, setDrug] = useState('');
  const [dosage, setDosage] = useState('');
  const [frequency, setFrequency] = useState('');
  const [durationDays, setDurationDays] = useState(7);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    let prescription = null;
    if (hasPrescription && drug && dosage && frequency) {
      prescription = {
        drugName: drug,
        dosage,
        frequency,
        durationDays
      };
    }

    try {
      const res = await fetch('/api/doctor/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId,
          doctorNotes: notes,
          prescription
        })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <Alert variant="success">
        Visit completed! AI is now generating the patient summary and scheduling reminders.
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Post-Visit Clinical Notes</CardTitle>
      </CardHeader>
      <CardContent>
        {error && <Alert variant="error" className="mb-4">{error}</Alert>}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Clinical Notes (Internal & sent to AI for summary)</label>
            <textarea 
              required
              rows={5}
              className="w-full p-3 border rounded-xl focus:ring-brand-primary"
              placeholder="e.g. Patient presents with acute migraine. Vitals stable. Advised rest..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="pt-4 border-t border-gray-100">
            <label className="flex items-center space-x-3 mb-4 cursor-pointer">
              <input 
                type="checkbox" 
                className="w-5 h-5 text-brand-primary rounded focus:ring-brand-primary"
                checked={hasPrescription}
                onChange={(e) => setHasPrescription(e.target.checked)}
              />
              <span className="font-medium text-gray-900">Add Prescription</span>
            </label>

            {hasPrescription && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Drug Name</label>
                  <input type="text" required={hasPrescription} value={drug} onChange={e => setDrug(e.target.value)} className="w-full p-2 border rounded-md" placeholder="e.g. Amoxicillin" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Dosage</label>
                  <input type="text" required={hasPrescription} value={dosage} onChange={e => setDosage(e.target.value)} className="w-full p-2 border rounded-md" placeholder="e.g. 500mg" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Frequency</label>
                  <select required={hasPrescription} value={frequency} onChange={e => setFrequency(e.target.value)} className="w-full p-2 border rounded-md bg-white">
                    <option value="">Select frequency</option>
                    <option value="Once daily">Once daily</option>
                    <option value="Twice daily">Twice daily</option>
                    <option value="Three times daily">Three times daily</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Duration (Days)</label>
                  <input type="number" required={hasPrescription} min="1" value={durationDays} onChange={e => setDurationDays(parseInt(e.target.value))} className="w-full p-2 border rounded-md" />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button type="submit" isLoading={loading}>Complete Visit</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
