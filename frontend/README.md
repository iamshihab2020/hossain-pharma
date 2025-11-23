# Hossain Pharmaceuticals - Frontend

Modern Next.js 15 frontend application for the Hossain Pharmaceuticals e-commerce platform.

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript (Strict Mode)
- **Styling**: Tailwind CSS + shadcn/ui
- **Authentication**: NextAuth.js v5 + Firebase (Google OAuth)
- **State Management**: TanStack Query + Zustand
- **Forms**: React Hook Form + Zod
- **Payments**: Stripe Elements
- **Icons**: Lucide React

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Installation

1. Install dependencies:
```bash
npm install
```

2. Setup environment variables:
```bash
cp .env.example .env.local
```

3. Edit `.env.local` with your configuration

### Development

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build

Build for production:

```bash
npm run build
npm start
```

## Project Structure

```
app/
├── (auth)/              # Authentication pages
├── (main)/              # Public pages
├── (dashboard)/         # Dashboard pages
├── api/                 # API routes
├── layout.tsx           # Root layout
├── providers.tsx        # Context providers
└── globals.css          # Global styles

components/
├── ui/                  # shadcn/ui components
├── auth/                # Auth components
├── products/            # Product components
├── cart/                # Cart components
├── dashboard/           # Dashboard components
└── layout/              # Layout components

lib/
├── api/                 # API client functions
├── hooks/               # Custom hooks
├── utils/               # Utility functions
├── stores/              # Zustand stores
└── validations/         # Zod schemas
```

## Available Scripts

- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript type checking

## Features

- ✅ Server-side rendering (SSR)
- ✅ Dark mode support
- ✅ Responsive design
- ✅ Type-safe API calls
- ✅ Form validation
- ✅ Authentication with dual providers
- ✅ Optimistic updates
- ✅ Image optimization

## Next Steps

1. Install shadcn/ui components
2. Setup authentication
3. Build page layouts
4. Implement features
