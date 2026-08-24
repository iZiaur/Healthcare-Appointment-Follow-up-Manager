'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';

type Slot = { id: string; startTime: string; endTime: string };
type Appointment = { id: string; heldUntil: string | null };

export default function BookingWizard({ doctorId, patientId }: { doctorId: string, patientId: string }) {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [step, setStep] = useState<1 | 2 | 3>(1); // 1: slots, 2: symptoms, 3: success
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  
  const [symptoms, setSymptoms] = useState('');
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

  // Fetch slots when date changes
  useEffect(() => {
    if (step !== 1) return;
    
    let isMounted = true;
    const fetchSlots = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/patient/book?doctorId=${doctorId}&date=${date}`);
        const data = await res.json();
        if (isMounted) setSlots(data);
      } catch (err) {
        if (isMounted) setError('Failed to load slots');
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchSlots();
    return () => { isMounted = false };
  }, [date, doctorId, step]);

  // Live Countdown Effect
  useEffect(() => {
    if (step === 2 && appointment?.heldUntil) {
      const holdTime = new Date(appointment.heldUntil).getTime();
      
      const interval = setInterval(() => {
        const now = new Date().getTime();
        const diff = Math.floor((holdTime - now) / 1000);
        
        if (diff <= 0) {
          clearInterval(interval);
          setTimeRemaining(0);
          setError('Hold expired. Please select a slot again.');
          setStep(1); // Force them back
        } else {
          setTimeRemaining(diff);
        }
      }, 1000);
      
      return () => clearInterval(interval);
    }
  }, [step, appointment]);

  const handleHold = async (slotId: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/patient/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'hold', patientId, doctorId, slotId })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      setAppointment(data);
      setStep(2);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    // Convert text area to string array roughly
    const symptomArray = symptoms.split('\n').filter(s => s.trim().length > 0);
    
    try {
      const res = await fetch('/api/patient/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', appointmentId: appointment!.id, symptoms: symptomArray })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      setStep(3);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (step === 3) {
    return (
      <Card className="max-w-2xl mx-auto text-center py-12">
        <CardContent>
          <div className="w-16 h-16 bg-status-success-bg text-status-success-text rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-2">Booking Confirmed!</h2>
          <p className="text-gray-600 mb-6">Your appointment has been successfully scheduled. We've sent a confirmation email to you and the doctor.</p>
          <Button onClick={() => window.location.href = '/patient/dashboard'}>Go to Dashboard</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {error && <Alert variant="error" className="mb-6">{error}</Alert>}
      
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Select a Time</CardTitle>
          </CardHeader>
          <CardContent>
            <input 
              type="date" 
              value={date} 
              onChange={(e) => setDate(e.target.value)}
              className="mb-6 p-2 border rounded-xl w-full max-w-xs focus:ring-brand-primary"
              min={new Date().toISOString().split('T')[0]}
            />
            
            {loading ? (
              <div className="text-gray-500 py-8 text-center">Loading available slots...</div>
            ) : slots.length === 0 ? (
              <div className="text-gray-500 py-8 text-center bg-gray-50 rounded-xl">No slots available for this date.</div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
                {slots.map(slot => (
                  <Button 
                    key={slot.id} 
                    variant="outline" 
                    onClick={() => handleHold(slot.id)}
                    disabled={loading}
                    className="w-full"
                  >
                    {slot.startTime}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Complete Booking</CardTitle>
            {timeRemaining !== null && (
              <div className="flex items-center text-status-failed-text font-mono font-bold bg-status-failed-bg px-3 py-1 rounded-pill">
                <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {Math.floor(timeRemaining / 60)}:{(timeRemaining % 60).toString().padStart(2, '0')}
              </div>
            )}
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-6">
              This slot is temporarily held for you. Please describe your symptoms below to confirm your booking. Our AI will analyze this to help the doctor prepare.
            </p>
            
            <form onSubmit={handleConfirm}>
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">Symptoms & Reason for Visit</label>
                <textarea 
                  required
                  rows={4}
                  className="w-full p-3 border rounded-xl focus:ring-brand-primary focus:border-brand-primary"
                  placeholder="e.g. Constant headache for 3 days, mild fever..."
                  value={symptoms}
                  onChange={(e) => setSymptoms(e.target.value)}
                  disabled={loading}
                />
              </div>
              
              <div className="flex justify-end space-x-4">
                <Button variant="outline" type="button" onClick={() => setStep(1)} disabled={loading}>Cancel Hold</Button>
                <Button type="submit" isLoading={loading}>Confirm Booking</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
