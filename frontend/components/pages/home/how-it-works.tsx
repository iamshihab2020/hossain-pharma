'use client';

import { Search, FileCheck, Package, CheckCircle } from 'lucide-react';
import { motion } from 'framer-motion';

const steps = [
  {
    icon: <Search className="w-8 h-8" aria-hidden="true" />,
    title: 'Search Medicines',
    description: 'Browse or search for the medicines you need from thousands of options',
  },
  {
    icon: <FileCheck className="w-8 h-8" aria-hidden="true" />,
    title: 'Upload Prescription',
    description: 'Upload your prescription if required. Our pharmacist will verify it',
  },
  {
    icon: <Package className="w-8 h-8" aria-hidden="true" />,
    title: 'Compare & Order',
    description: 'Compare prices across vendors and place your order with best deal',
  },
  {
    icon: <CheckCircle className="w-8 h-8" aria-hidden="true" />,
    title: 'Fast Delivery',
    description: 'Get your medicines delivered to your doorstep within hours',
  },
];

export function HowItWorks() {
  return (
    <section className="py-16 w-full px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-background to-muted/30" aria-labelledby="how-it-works-heading">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h2 id="how-it-works-heading" className="text-3xl font-bold mb-2">
            How It Works
          </h2>
          <p className="text-muted-foreground">
            Simple steps to get your medicines delivered
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {steps.map((step, index) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1, duration: 0.3 }}
              className="text-center relative"
            >
              {index < steps.length - 1 && (
                <div className="hidden lg:block absolute top-10 left-[60%] w-[80%] h-0.5 bg-border" aria-hidden="true" />
              )}

              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center text-primary relative z-10">
                {step.icon}
              </div>

              <div className="w-8 h-8 mx-auto mb-3 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                {index + 1}
              </div>

              <h3 className="font-semibold text-lg mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
