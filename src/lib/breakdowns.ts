import { createClient } from "@/lib/supabase";
import type { Step } from "@/app/components/Timeline";

export type SavedBreakdown = {
  id: string;
  title: string;
  video_name: string | null;
  chunk_size: number;
  created_at: string;
};

async function ensureSignedIn() {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  if (data.session) return supabase;

  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return supabase;
}

export async function listBreakdowns(): Promise<SavedBreakdown[]> {
  const supabase = await ensureSignedIn();
  const { data, error } = await supabase
    .from("breakdowns")
    .select("id, title, video_name, chunk_size, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function saveBreakdown(params: {
  title: string;
  videoName: string;
  chunkSize: number;
  steps: Step[];
}): Promise<string> {
  const supabase = await ensureSignedIn();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not signed in");

  const { data: breakdown, error: breakdownError } = await supabase
    .from("breakdowns")
    .insert({
      user_id: userId,
      title: params.title,
      video_name: params.videoName,
      chunk_size: params.chunkSize,
    })
    .select("id")
    .single();
  if (breakdownError) throw breakdownError;

  if (params.steps.length > 0) {
    const rows = params.steps.map((step, i) => ({
      breakdown_id: breakdown.id,
      position: i,
      start_time: step.start,
      end_time: step.end,
      count: step.count ?? null,
      word_tag: step.word_tag ?? null,
      meaning_tag: step.meaning_tag ?? null,
    }));
    const { error: stepsError } = await supabase.from("steps").insert(rows);
    if (stepsError) throw stepsError;
  }

  return breakdown.id;
}

export async function loadBreakdown(
  id: string
): Promise<{ chunkSize: number; steps: Step[] }> {
  const supabase = await ensureSignedIn();
  const { data: breakdown, error: breakdownError } = await supabase
    .from("breakdowns")
    .select("chunk_size")
    .eq("id", id)
    .single();
  if (breakdownError) throw breakdownError;

  const { data: stepRows, error: stepsError } = await supabase
    .from("steps")
    .select("id, start_time, end_time, count, word_tag, meaning_tag")
    .eq("breakdown_id", id)
    .order("position", { ascending: true });
  if (stepsError) throw stepsError;

  return {
    chunkSize: breakdown.chunk_size,
    steps: stepRows.map((r) => ({
      id: r.id,
      start: r.start_time,
      end: r.end_time,
      count: r.count ?? undefined,
      word_tag: r.word_tag ?? undefined,
      meaning_tag: r.meaning_tag ?? undefined,
    })),
  };
}
