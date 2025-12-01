'use client';

import { Shield, Lock, Award, CheckCircle2, Clock, Package } from 'lucide-react';
import { motion } from 'framer-motion';

interface CertificationBadge {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}

const badges: CertificationBadge[] = [
  {
    icon: <Shield className="w-8 h-8" aria-hidden="true" />,
    title: 'VIPPS Accredited',
    subtitle: 'Verified by NABP',
  },
  {
    icon: <Award className="w-8 h-8" aria-hidden="true" />,
    title: 'FDA Registered',
    subtitle: 'Licensed Pharmacy',
  },
  {
    icon: <Lock className="w-8 h-8" aria-hidden="true" />,
    title: 'HIPAA Compliant',
    subtitle: 'Secure & Private',
  },
  {
    icon: <CheckCircle2 className="w-8 h-8" aria-hidden="true" />,
    title: '100% Authentic',
    subtitle: 'Genuine Medicines',
  },
  {
    icon: <Clock className="w-8 h-8" aria-hidden="true" />,
    title: '24/7 Support',
    subtitle: 'Always Available',
  },
  {
    icon: <Package className="w-8 h-8" aria-hidden="true" />,
    title: 'Fast Delivery',
    subtitle: 'Same Day Available',
  },
];

export function CertificationBadges() {
  return (
    <section className="py-8 border-y bg-muted/30" aria-label="Trust and certifications">
      <div className="container">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
          {badges.map((badge, index) => (
            <motion.div
              key={badge.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1, duration: 0.3 }}
              className="flex flex-col items-center text-center p-4 rounded-lg hover:bg-background transition-colors"
            >
              <div className="text-trust mb-2" aria-hidden="true">
                {badge.icon}
              </div>
              <h3 className="font-semibold text-sm mb-1">{badge.title}</h3>
              <p className="text-xs text-muted-foreground">{badge.subtitle}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
