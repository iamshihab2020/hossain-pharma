'use client';

import { useState } from 'react';
import { Filter, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Category } from '@/types/category';
import { cn } from '@/lib/utils';

export interface FilterState {
  categories: string[];
  priceRange: [number, number];
  prescriptionRequired: boolean | null;
}

interface ShopFiltersProps {
  categories: Category[];
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  maxPrice?: number;
  className?: string;
}

export function ShopFilters({
  categories,
  filters,
  onFiltersChange,
  maxPrice = 1000,
  className,
}: ShopFiltersProps) {
  const [openSections, setOpenSections] = useState({
    categories: true,
    price: true,
    prescription: true,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleCategoryChange = (categoryTag: string, checked: boolean) => {
    const newCategories = checked
      ? [...filters.categories, categoryTag]
      : filters.categories.filter((c) => c !== categoryTag);
    onFiltersChange({ ...filters, categories: newCategories });
  };

  const handlePriceChange = (value: number[]) => {
    onFiltersChange({
      ...filters,
      priceRange: [value[0], value[1]] as [number, number],
    });
  };

  const handlePrescriptionChange = (value: boolean | null) => {
    onFiltersChange({ ...filters, prescriptionRequired: value });
  };

  const clearFilters = () => {
    onFiltersChange({
      categories: [],
      priceRange: [0, maxPrice],
      prescriptionRequired: null,
    });
  };

  const activeFilterCount =
    filters.categories.length +
    (filters.priceRange[0] > 0 || filters.priceRange[1] < maxPrice ? 1 : 0) +
    (filters.prescriptionRequired !== null ? 1 : 0);

  const FilterContent = () => (
    <div className="space-y-6">
      {/* Categories */}
      <Collapsible
        open={openSections.categories}
        onOpenChange={() => toggleSection('categories')}
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between py-2">
          <span className="text-sm font-medium">Categories</span>
          {openSections.categories ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          {categories.map((category) => (
            <div key={category._id} className="flex items-center space-x-2">
              <Checkbox
                id={`category-${category.categoryTag}`}
                checked={filters.categories.includes(category.categoryTag)}
                onCheckedChange={(checked) =>
                  handleCategoryChange(category.categoryTag, checked === true)
                }
              />
              <Label
                htmlFor={`category-${category.categoryTag}`}
                className="text-sm font-normal cursor-pointer"
              >
                {category.name}
              </Label>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>

      {/* Price Range */}
      <Collapsible
        open={openSections.price}
        onOpenChange={() => toggleSection('price')}
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between py-2">
          <span className="text-sm font-medium">Price Range</span>
          {openSections.price ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-4">
          <Slider
            min={0}
            max={maxPrice}
            step={10}
            value={[filters.priceRange[0], filters.priceRange[1]]}
            onValueChange={handlePriceChange}
            className="w-full"
          />
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>${filters.priceRange[0]}</span>
            <span>${filters.priceRange[1]}</span>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Prescription Required */}
      <Collapsible
        open={openSections.prescription}
        onOpenChange={() => toggleSection('prescription')}
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between py-2">
          <span className="text-sm font-medium">Prescription</span>
          {openSections.prescription ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="prescription-no"
              checked={filters.prescriptionRequired === false}
              onCheckedChange={(checked) =>
                handlePrescriptionChange(checked ? false : null)
              }
            />
            <Label
              htmlFor="prescription-no"
              className="text-sm font-normal cursor-pointer"
            >
              Over-the-counter only
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="prescription-yes"
              checked={filters.prescriptionRequired === true}
              onCheckedChange={(checked) =>
                handlePrescriptionChange(checked ? true : null)
              }
            />
            <Label
              htmlFor="prescription-yes"
              className="text-sm font-normal cursor-pointer"
            >
              Prescription required
            </Label>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Clear filters */}
      {activeFilterCount > 0 && (
        <Button
          variant="outline"
          className="w-full"
          onClick={clearFilters}
        >
          <X className="mr-2 h-4 w-4" />
          Clear all filters
        </Button>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop filters */}
      <aside className={cn('hidden lg:block', className)}>
        <div className="sticky top-20 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Filters</h2>
            {activeFilterCount > 0 && (
              <Badge variant="secondary">{activeFilterCount} active</Badge>
            )}
          </div>
          <FilterContent />
        </div>
      </aside>

      {/* Mobile filters */}
      <div className="lg:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Filter className="h-4 w-4" />
              Filters
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
            </SheetHeader>
            <div className="mt-6">
              <FilterContent />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

// Helper to get default filter state
export const getDefaultFilters = (maxPrice: number = 1000): FilterState => ({
  categories: [],
  priceRange: [0, maxPrice],
  prescriptionRequired: null,
});
