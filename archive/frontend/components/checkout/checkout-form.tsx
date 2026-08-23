'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ShippingForm, ShippingData } from './shipping-form';
import { PaymentForm } from './payment-form';
import { OrderReview } from './order-review';
import { CartSummary as CartSummaryType } from '@/types/cart';

interface CheckoutFormProps {
  summary: CartSummaryType;
  onSuccess: (transactionId: string) => void;
}

type Step = 'shipping' | 'payment' | 'review';

const steps: { id: Step; label: string }[] = [
  { id: 'shipping', label: 'Shipping' },
  { id: 'payment', label: 'Payment' },
  { id: 'review', label: 'Review' },
];

export function CheckoutForm({ summary, onSuccess }: CheckoutFormProps) {
  const [currentStep, setCurrentStep] = useState<Step>('shipping');
  const [shippingData, setShippingData] = useState<ShippingData | null>(null);
  const [paymentReady, setPaymentReady] = useState(false);

  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);

  const handleShippingSubmit = (data: ShippingData) => {
    setShippingData(data);
    setCurrentStep('payment');
  };

  const handlePaymentReady = () => {
    setPaymentReady(true);
    setCurrentStep('review');
  };

  const handleBack = () => {
    if (currentStep === 'payment') {
      setCurrentStep('shipping');
    } else if (currentStep === 'review') {
      setCurrentStep('payment');
    }
  };

  return (
    <div className="space-y-8">
      {/* Steps indicator */}
      <nav aria-label="Checkout progress">
        <ol className="flex items-center justify-center gap-2 sm:gap-4">
          {steps.map((step, index) => {
            const isCompleted = index < currentStepIndex;
            const isCurrent = step.id === currentStep;

            return (
              <li key={step.id} className="flex items-center gap-2 sm:gap-4">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-medium transition-colors',
                      isCompleted
                        ? 'border-primary bg-primary text-primary-foreground'
                        : isCurrent
                        ? 'border-primary text-primary'
                        : 'border-muted-foreground/30 text-muted-foreground'
                    )}
                  >
                    {isCompleted ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      index + 1
                    )}
                  </div>
                  <span
                    className={cn(
                      'hidden text-sm font-medium sm:block',
                      isCurrent
                        ? 'text-foreground'
                        : 'text-muted-foreground'
                    )}
                  >
                    {step.label}
                  </span>
                </div>

                {index < steps.length - 1 && (
                  <div
                    className={cn(
                      'h-px w-8 sm:w-16',
                      index < currentStepIndex
                        ? 'bg-primary'
                        : 'bg-muted-foreground/30'
                    )}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Step content */}
      <div className="rounded-lg border bg-card p-6">
        {currentStep === 'shipping' && (
          <ShippingForm
            initialData={shippingData}
            onSubmit={handleShippingSubmit}
          />
        )}

        {currentStep === 'payment' && (
          <PaymentForm
            amount={summary.total}
            onReady={handlePaymentReady}
            onBack={handleBack}
          />
        )}

        {currentStep === 'review' && shippingData && (
          <OrderReview
            summary={summary}
            shippingData={shippingData}
            onBack={handleBack}
            onSuccess={onSuccess}
          />
        )}
      </div>
    </div>
  );
}
