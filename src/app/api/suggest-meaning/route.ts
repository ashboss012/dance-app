import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not set in environment" },
      { status: 500 }
    );
  }

  const { word_tag } = await req.json();
  if (!word_tag || typeof word_tag !== "string") {
    return NextResponse.json({ error: "word_tag is required" }, { status: 400 });
  }

  const prompt =
    `You are helping label dance steps for a dance-learning app. ` +
    `Given a word or lyric associated with a dance step, write a single short phrase ` +
    `(5-10 words) describing the body movement or gesture a dancer would do at that moment. ` +
    `Reply with only the gesture phrase, no punctuation, no explanation.\n\nWord/lyric: "${word_tag}"`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 40, temperature: 0.7 },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: res.status });
  }

  const data = await res.json();
  const suggestion: string =
    data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

  return NextResponse.json({ suggestion });
}
