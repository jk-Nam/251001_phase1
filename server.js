// es-module -> import, commonjs -> require
const express = require("express"); // express 안에 있는 이미 구현되어 있는 코드들을 express 객체 형태로 불러오기
const cors = require("cors"); // 설치한 의존성 패키지 cors를 불러오기
const dotenv = require("dotenv"); // 설치한 의존성 패키지 dotenv를 불러오기
const { createClient } = require("@supabase/supabase-js"); // 구조분해 할당
const { GoogleGenAI } = require("@google/genai");

dotenv.config(); // .env -> KEY => SUPABASE_KEY
// NODE -> pocess.env (환경변수) // cf. env file

// const supabaseKey = process.env.SUPABASE_KEY;
// const supabaseUrl = process.env.SUPABASE_URL;
const { SUPABASE_KEY: supabaseKey, SUPABASE_URL: supabaseUrl } = process.env;
console.log("supabaseKey : ", supabaseKey);
console.log("supabaseUrl : ", supabaseUrl);
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express(); // () -> 호출해서 사용
// 포트 -> 컴퓨터 서비스가 1개만 있는게 아님. email, db, server 1, server 2...
// 1 ~ 2xxxx. => 이 번호로 오세요...
const port = 3000; // cra. next -> express. / 5173.
// localhost -> 3000. / 5500? <-> 구분해주는 의미.

// cors에러 해결을 위한 미들웨어 적용
app.use(cors()); // 모든 출처에 대한 허용 (보안적으로 바람직 X)
app.use(express.json()); // req.body -> json

// get, post...
// app.방식(접속경로, 핸들러)
// localhost:3000/
app.get("/", (req, res) => {
  // req -> request -> 전달 받은 데이터나 요청사항
  // res -> response -> 응답할 내용/방식을 담은 객체
  //   res.send("hello");
  res.send("bye");
});

app.get("/plans", async (req, res) => {
  const { data, error } = await supabase.from("tour_plan").select("*");
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json(data);
});

// 1. SDK
// 2. API Key <- .env
// 3. 여러 단계를 프롬프팅 -> (값) => (프롬프트) => (결과값)
app.post("/plans", async (req, res) => {
  const plan = req.body;
  // ai를 통해
  // npm install @google/genai
  const ai = new GoogleGenAI({}); // GEMINI_API_KEY 알아서 인식해줌
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `
    [장소] ${plan.destination}
    [목적] ${plan.purpose}
    [인원수] ${plan.people_count}
    [시작일] ${plan.start_date}
    [종료일] ${plan.end_date}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
          },
        },
        required: ["prompt"],
      },
      systemInstruction: [
        // { text: "제공받은 정보를 바탕으로 여행 계획을 짜되, 300자 이내로." },
        {
          text: `제공받은 정보를 바탕으로 최적의 여행 계획을 세우기 위한 프롬프트를 작성해줘. 응답은 JSON 형식으로 {"prompt": "프롬프트 내용" 형식으로 작성해줘.}`,
        },
      ],
      // structured output
    },
  });
  const { prompt } = JSON.parse(response.text);
  console.log("prompt", prompt);
  const response2 = await ai.models.generateContent({
    model: "gemini-2.5-flash-lite", // 모델을 상대적으로 약한 모델로...
    contents: prompt,
    config: {
      systemInstruction: [
        {
          text: "프롬프트에 따라 작성하되, 300자 이내의 마크다운이 아닌 평문으로.",
        },
      ],
    },
  });
  plan.ai_suggestion = response2.text;
  const { error } = await supabase.from("tour_plan").insert(plan);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.status(201).json();
});

app.delete("/plans", async (req, res) => {
  const { planId } = req.body;
  const { error } = await supabase
    .from("tour_plan") // table
    .delete() // 삭제
    .eq("id", planId); //equal -> id === planId
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.status(204).json(); // noContent
});

//DOM listener / server '대기' -> 특정한 요청 -> 응답
app.listen(port, () => {
  console.log(`서버가 ${port}번 포트로 실행 중입니다.`);
});
