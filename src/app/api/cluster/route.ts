import { ClusterBody, handle } from "@/lib/api";
import { stepCluster } from "@/lib/pipeline";

export const maxDuration = 300;

export function POST(req: Request) {
  return handle(req, ClusterBody, (b, llm) => stepCluster(b.task, b.answers, b.grades, llm));
}
