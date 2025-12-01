'use client';

import { Star, Quote } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getTopTestimonials } from '@/lib/mock-data/testimonials';
import Image from 'next/image';
import { motion } from 'framer-motion';

export function Testimonials() {
  const testimonials = getTopTestimonials(6);

  return (
    <section className="py-16" aria-labelledby="testimonials-heading">
      <div className="container">
        <div className="text-center mb-12">
          <h2 id="testimonials-heading" className="text-3xl font-bold mb-2">
            What Our Customers Say
          </h2>
          <p className="text-muted-foreground">
            Trusted by thousands of satisfied customers
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={testimonial.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1, duration: 0.3 }}
            >
              <Card className="p-6 h-full flex flex-col">
                <Quote className="w-8 h-8 text-muted-foreground mb-3" aria-hidden="true" />

                <div className="flex items-center gap-1 mb-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`w-4 h-4 ${
                        i < testimonial.rating
                          ? 'fill-yellow-400 text-yellow-400'
                          : 'text-muted'
                      }`}
                      aria-hidden="true"
                    />
                  ))}
                </div>

                <p className="text-sm mb-4 flex-grow">{testimonial.review}</p>

                <div className="flex items-center gap-3 pt-4 border-t">
                  <Image
                    src={testimonial.customerAvatar}
                    alt={testimonial.customerName}
                    width={40}
                    height={40}
                    className="rounded-full"
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-sm">{testimonial.customerName}</div>
                    {testimonial.vendorName && (
                      <div className="text-xs text-muted-foreground">
                        {testimonial.vendorName}
                      </div>
                    )}
                  </div>
                  {testimonial.isVerified && (
                    <Badge variant="secondary" className="text-xs">
                      Verified
                    </Badge>
                  )}
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
