import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "@/components/me/profile-page";

export const Route = createFileRoute("/_app/profile")({
  component: () => <ProfilePage />,
});
