import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidUsername } from "@/lib/username";

export const usernameSchema = z.string().refine(isValidUsername, "Invalid username");

export function ok<T>(data: T): NextResponse<T> {
  return NextResponse.json(data);
}

export function fail(error: unknown, status = 400): NextResponse<{ error: string }> {
  const message = error instanceof Error ? error.message : "Request failed";
  return NextResponse.json({ error: message }, { status });
}
