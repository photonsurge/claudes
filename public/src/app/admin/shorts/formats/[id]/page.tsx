"use client";

/** /admin/shorts/formats/:id — a short format's editor; the body is a client component. */
import { useParams } from "next/navigation";
import FormatEditor from "../../../../../components/admin/shorts/formats/FormatEditor";

export default function Page() {
  const params = useParams<{ id: string }>();
  const id = params?.id ? decodeURIComponent(params.id) : "";
  return id ? <FormatEditor formatId={id} /> : null;
}
