import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidUsername } from "@/lib/username";

export const usernameSchema = z.string().refine(isValidUsername, "Invalid username");

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function ok<T>(data: T): NextResponse<T> {
  return NextResponse.json(data);
}

export function fail(error: unknown, status = 400): NextResponse<{ error: string }> {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: "请求参数无效" }, { status: 400 });
  }

  const responseStatus = status >= 500 ? 500 : status;
  const message = responseStatus >= 500 ? "服务暂时不可用" : "请求失败";
  return NextResponse.json({ error: message }, { status: responseStatus });
}
