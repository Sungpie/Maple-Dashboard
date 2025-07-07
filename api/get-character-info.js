// Vercel 환경에서 외부와 통신하기 위한 기본 모듈
const https = require("https");

// 넥슨 서버에 안전하게 데이터를 요청하고 응답을 받는 똑똑한 함수
function nexonApiRequest(path, apiKey) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "open.api.nexon.com",
      path: path,
      method: "GET",
      headers: {
        "x-nxopen-api-key": apiKey,
      },
    };

    const req = https.request(options, (res) => {
      // 1. 응답 상태 코드 확인 (200이 아니면 에러)
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(
          new Error(`Nexon API Error: Status Code ${res.statusCode}`)
        );
      }

      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          // 2. 받은 데이터가 JSON 형식인지 분석 시도
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Failed to parse Nexon API response."));
        }
      });
    });

    req.on("error", (e) => {
      // 3. 네트워크 요청 자체에 문제가 생겼을 때 에러 처리
      reject(new Error(`Network request failed: ${e.message}`));
    });

    req.end();
  });
}

// 우리의 '비서' 프로그램 메인 로직
export default async function handler(request, response) {
  try {
    const characterName = request.query.characterName;
    if (!characterName) {
      return response.status(400).json({ error: "캐릭터 이름이 필요합니다." });
    }

    const apiKey = process.env.NEXON_API_KEY;
    if (!apiKey) {
      throw new Error("API 키가 서버에 설정되지 않았습니다.");
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateString = yesterday.toISOString().split("T")[0];

    // OCID 조회
    const ocidData = await nexonApiRequest(
      `/maplestory/v1/id?character_name=${encodeURIComponent(characterName)}`,
      apiKey
    );
    const ocid = ocidData.ocid;
    if (!ocid) {
      return response.status(404).json({ error: "캐릭터를 찾을 수 없습니다." });
    }

    // 필요한 모든 정보를 동시에 요청
    const [basicData, statData, itemData] = await Promise.all([
      nexonApiRequest(
        `/maplestory/v1/character/basic?ocid=${ocid}&date=${dateString}`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&date=${dateString}`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/character/item-equipment?ocid=${ocid}&date=${dateString}`,
        apiKey
      ),
    ]);

    // 최종적으로 모든 정보를 합쳐서 클라이언트에게 성공적으로 전달
    response.status(200).json({
      basicData,
      statData,
      itemData,
    });
  } catch (error) {
    // ✨ 어떤 종류의 에러가 발생하든, 여기서 잡아서 원인을 알려줌
    console.error("서버리스 함수에서 심각한 오류 발생:", error);
    response.status(500).json({
      error: "서버에서 요청을 처리하는 중 오류가 발생했습니다.",
      details: error.message,
    });
  }
}
