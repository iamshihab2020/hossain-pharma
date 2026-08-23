'use client';

import { Shield, Users, Package2, HeartPulse } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';

const stats = [
  {
    icon: <Users className="w-6 h-6" aria-hidden="true" />,
    value: '500K+',
    label: 'Happy Customers',
  },
  {
    icon: <Package2 className="w-6 h-6" aria-hidden="true" />,
    value: '15K+',
    label: 'Medicines Available',
  },
  {
    icon: <Shield className="w-6 h-6" aria-hidden="true" />,
    value: '100%',
    label: 'Authentic Products',
  },
  {
    icon: <HeartPulse className="w-6 h-6" aria-hidden="true" />,
    value: '24/7',
    label: 'Licensed Pharmacists',
  },
];

export function TrustBanner() {
  return (
    <section className="py-12 bg-gradient-to-b w-full px-4 sm:px-6 lg:px-8 from-background to-muted/30" aria-label="Platform statistics and trust indicators">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-8"
        >
          <h2 className="text-3xl font-bold mb-2">Trusted by Thousands</h2>
          <p className="text-muted-foreground">
            Your health and safety are our top priorities
          </p>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1, duration: 0.3 }}
            >
              <Card className="p-6 text-center hover:shadow-lg transition-all">
                <div className="flex justify-center text-trust mb-3">
                  {stat.icon}
                </div>
                <div className="text-3xl font-bold mb-1">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
