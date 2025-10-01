const { createClient } = require("@supabase/supabase-js");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { GoogleGenAI } = require("@google/genai");
const { Groq } = require("groq-sdk");

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

app.get("/plan", async (req, res) => {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data, error } = await supabase.from("plan").select("*");
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.status(200).json(data);
});

app.post("/plan", async (req, res) => {
  // Chaining
  // 여러 단계를 거쳐서 최종 결과를 얻기
  const prompt = `여행지: ${req.body.destination}, 목적: ${req.body.purpose}, 인원 수: ${req.body["people-count"]}, 시작일: ${req.body["start-date"]}, 종료일: ${req.body["end-date"]}`;
  // 프롬프트를 AI 모델에 보내기
  const plan = await chaining(prompt);
  req.body["ai-plan"] = plan;
  // Ensemble
  // 여러개 모델 혹은 서로 다른 프롬프트로 다수의 답변을 얻기 -> 답변을 조합
  const budget = await ensemble(plan);
  req.body["ai-min-budget"] = budget.minBudget;
  req.body["ai-max-budget"] = budget.maxBudget;
  // 결과를 DB에 저장
  const supabase = createClient(supabaseUrl, supabaseKey);
  const { error } = await supabase.from("plan").insert(req.body);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.status(201).json();
});

app.delete("/plan", async (req, res) => {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const { error } = await supabase.from("plan").delete().eq("id", req.body.id);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.status(204).json();
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

async function chaining(prompt) {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });
  const config = {
    responseMimeType: "application/json",
    responseSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
        },
      },
      required: ["prompt"],
      propertyOrdering: ["prompt"],
    },
    systemInstruction: [
      {
        text: '최적의 여행 계획을 세우기 위한 프롬프트를 작성해줘. "여행지", "목적", "인원 수", "시작일", "종료일"을 고려해줘. 응답은 JSON 형식으로 {"prompt": "여기에 프롬프트 내용"}로 해줘.',
      },
    ],
  };
  const model = "gemini-2.5-flash";
  const contents = [
    {
      role: "user",
      parts: [
        {
          text: prompt,
        },
      ],
    },
  ];

  const response = await ai.models.generateContent({
    model,
    config,
    contents,
  });
  const { prompt: aiPrompt } = JSON.parse(response.text);
  console.log(aiPrompt);
  const config2 = {
    responseMimeType: "application/json",
    responseSchema: {
      type: "object",
      properties: {
        plan: {
          type: "string",
        },
      },
      required: ["plan"],
      propertyOrdering: ["plan"],
    },
    systemInstruction: [
      {
        text: '500자 이내의 평문으로 작성된 최적의 여행 계획을 세워줘. 응답은 JSON 형식으로 {"plan": "여기에 여행 계획 내용"}로 해줘.',
      },
    ],
  };
  const contents2 = [
    {
      role: "user",
      parts: [
        {
          text: aiPrompt,
        },
      ],
    },
  ];
  const response2 = await ai.models.generateContent({
    model,
    config: config2,
    contents: contents2,
  });
  const { plan } = JSON.parse(response2.text);
  console.log(plan);
  return plan;
}

async function ensemble(plan) {
  const groq = new Groq();
  const models = [
    "moonshotai/kimi-k2-instruct-0905",
    "openai/gpt-oss-120b",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
  ];
  const responses = await Promise.all(
    models.map((model) => {
      return groq.chat.completions.create({
        model,
        response_format: {
          type: "json_object",
        },
        messages: [
          {
            role: "system",
            content:
              '너는 여행 경비 전문가야. 주어진 여행 계획을 바탕으로 예산을 산출해줘. 응답은 JSON 형식으로 {"budget": "원화로 환산한 예산 합계"}로 해줘.',
          },
          {
            role: "user",
            content: plan,
          },
        ],
      });
    })
  );
  console.log(responses);
  // 응답을 조합하는 로직
  // 최소 ~ 최대
  const budgets = responses.map((response) => {
    return parseInt(
      JSON.parse(response.choices[0].message.content).budget.replace(
        /[^0-9]/g,
        ""
      )
    );
  });
  console.log(budgets);
  const minBudget = Math.min(...budgets);
  const maxBudget = Math.max(...budgets);
  return { minBudget, maxBudget };
}
