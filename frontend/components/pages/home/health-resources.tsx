'use client';

import { BookOpen, Video, FileText, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Image from 'next/image';
import Link from 'next/link';

const resources = [
  {
    icon: <BookOpen className="w-6 h-6" aria-hidden="true" />,
    title: 'Medicine Guides',
    description: 'Comprehensive guides on how to use your medications safely',
    image: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=400&h=300&fit=crop',
    link: '/guides',
  },
  {
    icon: <Video className="w-6 h-6" aria-hidden="true" />,
    title: 'Video Consultations',
    description: 'Book a video call with licensed pharmacists for personalized advice',
    image: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=400&h=300&fit=crop',
    link: '/consultations',
  },
  {
    icon: <FileText className="w-6 h-6" aria-hidden="true" />,
    title: 'Health Blog',
    description: 'Latest health tips, news, and wellness advice from experts',
    image: 'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=400&h=300&fit=crop',
    link: '/blog',
  },
];

export function HealthResources() {
  return (
    <section className="py-16 bg-muted/30 w-full px-4 sm:px-6 lg:px-8" aria-labelledby="health-resources-heading">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h2 id="health-resources-heading" className="text-3xl font-bold mb-2">
            Health Resources
          </h2>
          <p className="text-muted-foreground">
            Expert advice and information to help you stay healthy
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {resources.map((resource) => (
            <Card key={resource.title} className="overflow-hidden group hover:shadow-xl transition-all">
              <div className="relative h-48 overflow-hidden">
                <Image
                  src={resource.image}
                  alt={resource.title}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-4 left-4 text-white">
                  {resource.icon}
                </div>
              </div>

              <div className="p-6">
                <h3 className="font-semibold text-lg mb-2">{resource.title}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {resource.description}
                </p>

                <Button variant="outline" size="sm" asChild className="w-full">
                  <Link href={resource.link}>
                    Learn More
                    <ArrowRight className="w-4 h-4 ml-2" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
