// api/get-character-info.js

// Vercel 환경에서는 require를 사용할 수 있습니다.
const https = require("https");

export default async function handler(request, response) {
  // ✨ [핵심 수정] Vercel 환경에서 URL 파라미터를 가져오는 더 안정적인 방법
  const characterName = request.query.characterName;

  if (!characterName) {
    return response.status(400).json({ error: "캐릭터 이름이 필요합니다." });
  }

  // Vercel에 안전하게 저장된 API 키 가져오기
  const apiKey = process.env.NEXON_API_KEY;

  const myHeaders = {
    "x-nxopen-api-key": apiKey,
  };

  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateString = yesterday.toISOString().split("T")[0];

    // --- 넥슨 서버에 요청을 보내는 부분을 https 모듈로 변경하여 안정성 확보 ---
    const getNexonData = (path) => {
      return new Promise((resolve, reject) => {
        const options = {
          hostname: "open.api.nexon.com",
          path: path,
          method: "GET",
          headers: myHeaders,
        };
        const req = https.request(options, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve(JSON.parse(data)));
        });
        req.on("error", (error) => reject(error));
        req.end();
      });
    };

    // OCID 조회
    const ocidData = await getNexonData(
      `/maplestory/v1/id?character_name=${encodeURIComponent(characterName)}`
    );
    const ocid = ocidData.ocid;

    if (!ocid) {
      return response.status(404).json({ error: "캐릭터를 찾을 수 없습니다." });
    }

    // 필요한 모든 정보를 동시에 요청
    const [basicData, statData, itemData] = await Promise.all([
      getNexonData(
        `/maplestory/v1/character/basic?ocid=${ocid}&date=${dateString}`
      ),
      getNexonData(
        `/maplestory/v1/character/stat?ocid=${ocid}&date=${dateString}`
      ),
      getNexonData(
        `/maplestory/v1/character/item-equipment?ocid=${ocid}&date=${dateString}`
      ),
    ]);

    // 모든 정보를 합쳐서 클라이언트에게 전달
    response.status(200).json({
      basicData,
      statData,
      itemData,
    });
  } catch (error) {
    console.error("서버리스 함수 오류:", error);
    response
      .status(500)
      .json({ error: "서버에서 오류가 발생했습니다.", message: error.message });
  }
}
