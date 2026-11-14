import { GradeBody, handle } from "@/lib/api";
import { stepGrade } from "@/lib/pipeline";

export const maxDuration = 300;

export function POST(req: Request) {
  return handle(req, GradeBody, (b, llm) => stepGrade(b.task, b.answers, llm), { countsAsAnalysis: true });
}
