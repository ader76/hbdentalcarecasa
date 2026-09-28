"use client";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PatientPicker } from "@/components/PatientPicker";

function Patients() {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <h1 className="h1">Patients</h1>
      <PatientPicker onPick={(p) => router.push(`/patient?id=${p.id}`)} />
    </div>
  );
}

export default function Page() {
  return <AppShell><Patients /></AppShell>;
}
