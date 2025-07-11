const https = require("https");

// 넥슨 서버에 안전하게 데이터를 요청하는 함수
function nexonApiRequest(path, apiKey) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "open.api.nexon.com",
      path: path,
      method: "GET",
      headers: { "x-nxopen-api-key": apiKey },
    };
    const req = https.request(options, (res) => {
      // 넥슨 API가 에러 코드를 보내도 일단 데이터를 받기 위해 에러 처리는 잠시 보류
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          // 응답이 JSON이 아닐 경우 null을 반환하여 Promise.allSettled가 멈추지 않도록 함
          resolve(null);
        }
      });
    });
    req.on("error", (e) => resolve(null)); // 네트워크 에러 발생 시에도 null 반환
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

    // 1. OCID 조회 (이 요청은 반드시 성공해야 함)
    const ocidData = await nexonApiRequest(
      `/maplestory/v1/id?character_name=${encodeURIComponent(characterName)}`,
      apiKey
    );
    if (!ocidData || ocidData.error) {
      return response
        .status(404)
        .json({ error: "캐릭터 OCID를 찾을 수 없습니다." });
    }
    const ocid = ocidData.ocid;

    // ✨ [핵심 수정] 2. 여러 API 요청을 'allSettled'로 안전하게 동시에 처리
    const results = await Promise.allSettled([
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&date=${dateString}`,
        apiKey
      ), // 0: 현재 스탯
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&date=${dateString}&preset_no=1`,
        apiKey
      ), // 1: 프리셋 1 스탯
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&date=${dateString}&preset_no=2`,
        apiKey
      ), // 2: 프리셋 2 스탯
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&date=${dateString}&preset_no=3`,
        apiKey
      ), // 3: 프리셋 3 스탯
      nexonApiRequest(
        `/maplestory/v1/character/basic?ocid=${ocid}&date=${dateString}`,
        apiKey
      ), // 4: 기본 정보
      nexonApiRequest(
        `/maplestory/v1/character/item-equipment?ocid=${ocid}&date=${dateString}`,
        apiKey
      ), // 5: 현재 장비
    ]);

    // 3. 성공한 요청에서만 데이터 추출
    const currentStatData =
      results[0].status === "fulfilled" ? results[0].value : null;
    const preset1Stat =
      results[1].status === "fulfilled" ? results[1].value : null;
    const preset2Stat =
      results[2].status === "fulfilled" ? results[2].value : null;
    const preset3Stat =
      results[3].status === "fulfilled" ? results[3].value : null;
    const basicData =
      results[4].status === "fulfilled" ? results[4].value : null;
    const itemData =
      results[5].status === "fulfilled" ? results[5].value : null;

    if (!basicData || !currentStatData) {
      throw new Error("캐릭터의 필수 정보(기본/스탯)를 불러오지 못했습니다.");
    }

    // 4. 유효한 모든 프리셋의 전투력을 찾아 배열에 담기
    const combatPowers = [
      currentStatData,
      preset1Stat,
      preset2Stat,
      preset3Stat,
    ]
      .map((statData) => {
        if (statData && statData.final_stat) {
          const powerStat = statData.final_stat.find(
            (s) => s.stat_name === "전투력"
          );
          return powerStat ? parseInt(powerStat.stat_value) : 0;
        }
        return 0;
      })
      .filter((power) => power > 0); // 0인 값은 제외

    // 5. 가장 높은 전투력을 '최고 전투력'으로 확정
    const maxCombatPower =
      combatPowers.length > 0 ? Math.max(...combatPowers) : 0;

    // 6. 최종적으로 모든 정보를 합쳐서 클라이언트에게 전달
    response.status(200).json({
      basicData,
      statData: { ...currentStatData, max_combat_power: maxCombatPower }, // 현재 스탯 정보에 최고 전투력 값을 추가해서 전달
      itemData,
    });
  } catch (error) {
    console.error("서버리스 함수에서 심각한 오류 발생:", error);
    response.status(500).json({
      error: "서버에서 요청을 처리하는 중 오류가 발생했습니다.",
      details: error.message,
    });
  }
}
