'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ShoppingCart, Menu, X, Search, User, Heart, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { ThemeToggle } from './theme-toggle'

export function Navbar() {
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const cartItemCount = 3
  const wishlistCount = 5
  const isLoggedIn = false

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 flex h-16 items-center gap-4">
        <Link href="/" className="flex items-center space-x-2 shrink-0">
          <Package className="h-6 w-6 text-primary" />
          <span className="font-bold text-xl hidden sm:inline-block">
            Hossain Pharma
          </span>
        </Link>

        <div className="hidden md:flex items-center space-x-4 shrink-0">
          <Link
            href="/"
            className="text-sm font-medium transition-colors hover:text-primary"
          >
            Home
          </Link>
          <Link
            href="/shop"
            className="text-sm font-medium transition-colors hover:text-primary"
          >
            Shop
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                Categories
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>Browse Categories</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/category/pain-relief">Pain Relief</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/category/antibiotics">Antibiotics</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/category/vitamins">Vitamins & Supplements</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/category/cold-flu">Cold & Flu</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/category/diabetes">Diabetes Care</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Link
            href="/about"
            className="text-sm font-medium transition-colors hover:text-primary"
          >
            About
          </Link>
        </div>

        <div className="hidden lg:flex flex-1 max-w-md">
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search medicines..."
              className="pl-8 w-full"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 ml-auto shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setIsSearchOpen(!isSearchOpen)}
          >
            <Search className="h-5 w-5" />
          </Button>

          <ThemeToggle />

          <Link href="/wishlist">
            <Button variant="ghost" size="icon" className="relative">
              <Heart className="h-5 w-5" />
              {wishlistCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
                >
                  {wishlistCount}
                </Badge>
              )}
            </Button>
          </Link>

          <Link href="/cart">
            <Button variant="ghost" size="icon" className="relative">
              <ShoppingCart className="h-5 w-5" />
              {cartItemCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
                >
                  {cartItemCount}
                </Badge>
              )}
            </Button>
          </Link>

          {isLoggedIn ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <User className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/dashboard">Dashboard</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/orders">Orders</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/wishlist">Wishlist</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/profile">Profile</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Logout</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="hidden md:flex items-center gap-2">
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  Login
                </Button>
              </Link>
              <Link href="/signup">
                <Button size="sm">Sign Up</Button>
              </Link>
            </div>
          )}

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[300px] sm:w-[400px]">
              <nav className="flex flex-col space-y-4 mt-8">
                <Link
                  href="/"
                  className="text-sm font-medium transition-colors hover:text-primary"
                >
                  Home
                </Link>
                <Link
                  href="/shop"
                  className="text-sm font-medium transition-colors hover:text-primary"
                >
                  Shop
                </Link>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Categories</p>
                  <div className="ml-4 space-y-2">
                    <Link
                      href="/category/pain-relief"
                      className="block text-sm text-muted-foreground hover:text-primary"
                    >
                      Pain Relief
                    </Link>
                    <Link
                      href="/category/antibiotics"
                      className="block text-sm text-muted-foreground hover:text-primary"
                    >
                      Antibiotics
                    </Link>
                    <Link
                      href="/category/vitamins"
                      className="block text-sm text-muted-foreground hover:text-primary"
                    >
                      Vitamins & Supplements
                    </Link>
                    <Link
                      href="/category/cold-flu"
                      className="block text-sm text-muted-foreground hover:text-primary"
                    >
                      Cold & Flu
                    </Link>
                    <Link
                      href="/category/diabetes"
                      className="block text-sm text-muted-foreground hover:text-primary"
                    >
                      Diabetes Care
                    </Link>
                  </div>
                </div>
                <Link
                  href="/about"
                  className="text-sm font-medium transition-colors hover:text-primary"
                >
                  About
                </Link>
                {!isLoggedIn && (
                  <>
                    <Link href="/login">
                      <Button variant="outline" className="w-full">
                        Login
                      </Button>
                    </Link>
                    <Link href="/signup">
                      <Button className="w-full">Sign Up</Button>
                    </Link>
                  </>
                )}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {isSearchOpen && (
        <div className="lg:hidden border-t p-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search medicines..."
              className="pl-8 w-full"
              autoFocus
            />
          </div>
        </div>
      )}
    </nav>
  )
}
