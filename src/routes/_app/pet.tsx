import { createFileRoute } from '@tanstack/react-router';
import { PetPage } from '@/components/pet/pet-page';
export const Route = createFileRoute('/_app/pet')({ component: PetPage });
