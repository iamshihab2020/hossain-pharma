import { Testimonial } from '@/types/product';

export const mockTestimonials: Testimonial[] = [
  {
    id: 'test-1',
    customerName: 'Sarah Johnson',
    customerAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop',
    rating: 5,
    review: 'Excellent service! The prescription upload process was so easy, and my medication arrived within 2 hours. The pharmacist even called to confirm my allergy information. Highly recommended!',
    productName: 'Lisinopril 10mg',
    vendorName: 'HealthPlus Pharmacy',
    isVerified: true,
    date: new Date('2025-01-15'),
    helpfulCount: 24,
  },
  {
    id: 'test-2',
    customerName: 'Michael Chen',
    customerAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop',
    rating: 5,
    review: 'The drug interaction checker saved me from a potentially dangerous combination. I was about to take two medicines together that could have caused serious issues. Great safety feature!',
    vendorName: 'MediCare Express',
    isVerified: true,
    date: new Date('2025-01-10'),
    helpfulCount: 45,
  },
  {
    id: 'test-3',
    customerName: 'Emily Rodriguez',
    customerAvatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop',
    rating: 4,
    review: 'Love being able to compare prices across different pharmacies. Saved over $30 on my monthly prescription by choosing a different vendor. The platform makes it so easy!',
    productName: 'Metformin 500mg',
    vendorName: 'Wellness Pharmacy Co.',
    isVerified: true,
    date: new Date('2025-01-08'),
    helpfulCount: 31,
  },
  {
    id: 'test-4',
    customerName: 'David Thompson',
    customerAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop',
    rating: 5,
    review: 'As a senior citizen, I appreciate the large text options and simple navigation. The automatic refill reminders ensure I never run out of my heart medication. Thank you!',
    productName: 'Atorvastatin 20mg',
    vendorName: 'Family Care Drugs',
    isVerified: true,
    date: new Date('2025-01-05'),
    helpfulCount: 18,
  },
  {
    id: 'test-5',
    customerName: 'Jessica Williams',
    customerAvatar: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=100&h=100&fit=crop',
    rating: 5,
    review: 'The mobile app with barcode scanning is fantastic! I just scanned my old prescription bottle and reordered in seconds. Delivery was super fast too.',
    productName: 'Levothyroxine 50mcg',
    vendorName: 'QuickScript Pharmacy',
    isVerified: true,
    date: new Date('2025-01-03'),
    helpfulCount: 52,
  },
  {
    id: 'test-6',
    customerName: 'Robert Anderson',
    customerAvatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop',
    rating: 4,
    review: 'Great selection of both prescription and over-the-counter medications. The vendor ratings helped me choose a reliable pharmacy. Only wish delivery was slightly faster.',
    productName: 'Omeprazole 20mg',
    vendorName: 'CityMed Pharmacy',
    isVerified: true,
    date: new Date('2025-01-01'),
    helpfulCount: 15,
  },
  {
    id: 'test-7',
    customerName: 'Maria Garcia',
    customerAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop',
    rating: 5,
    review: 'The licensed pharmacists are always available to answer questions. I had a concern about side effects and got a detailed explanation within minutes. Exceptional customer service!',
    vendorName: 'HealthPlus Pharmacy',
    isVerified: true,
    date: new Date('2024-12-28'),
    helpfulCount: 38,
  },
  {
    id: 'test-8',
    customerName: 'James Wilson',
    customerAvatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=100&h=100&fit=crop',
    rating: 5,
    review: 'Perfect for managing my family\'s prescriptions. I can track medications for my kids and elderly parents all in one place. The refill reminders are a lifesaver!',
    vendorName: 'Wellness Pharmacy Co.',
    isVerified: true,
    date: new Date('2024-12-25'),
    helpfulCount: 29,
  },
];

export const getTopTestimonials = (count: number = 6) => {
  return [...mockTestimonials]
    .sort((a, b) => b.helpfulCount - a.helpfulCount)
    .slice(0, count);
};

export const getRecentTestimonials = (count: number = 6) => {
  return [...mockTestimonials]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, count);
};
