"use client";
export function IdentityProvider({ children }) {
  return children;
}
export function IdentityControls() {
  return null;
}
export function useIdentity() {
  return { stage: "public", authentication: "none" };
}
export function AuthPage() {
  return null;
}
