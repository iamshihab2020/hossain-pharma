'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import { createAd } from '@/lib/api/ads';
import { useAuthStore } from '@/lib/stores/auth-store';

const adSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100, 'Title is too long'),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(500, 'Description is too long'),
  image: z.string().url('Must be a valid URL'),
  link: z.string().url('Must be a valid URL').optional().or(z.literal('')),
});

type AdFormValues = z.infer<typeof adSchema>;

interface AdFormProps {
  onSuccess: () => void;
}

export function AdForm({ onSuccess }: AdFormProps) {
  const { user } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<AdFormValues>({
    resolver: zodResolver(adSchema),
    defaultValues: {
      title: '',
      description: '',
      image: '',
      link: '',
    },
  });

  const onSubmit = async (data: AdFormValues) => {
    if (!user?.email) return;

    setIsLoading(true);
    setError(null);

    try {
      await createAd({
        email: user.email,
        title: data.title,
        description: data.description,
        image: data.image,
        link: data.link || undefined,
        adsStatus: 'pending',
      });
      onSuccess();
    } catch (err) {
      setError('Failed to create advertisement. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Ad Title</FormLabel>
              <FormControl>
                <Input placeholder="Enter ad title" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Enter ad description"
                  rows={3}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="image"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Image URL</FormLabel>
              <FormControl>
                <Input placeholder="https://example.com/ad-image.jpg" {...field} />
              </FormControl>
              <FormDescription>Enter a direct link to the ad image</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="link"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Link URL (Optional)</FormLabel>
              <FormControl>
                <Input placeholder="https://example.com/product" {...field} />
              </FormControl>
              <FormDescription>Where users go when they click the ad</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-3 pt-4">
          <Button type="submit" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Submit Ad'
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
