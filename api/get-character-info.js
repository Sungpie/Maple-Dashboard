const https = require("https");

// 넥슨 서버에 안전하게 데이터를 요청하는 함수
function nexonApiRequest(path, apiKey) {
  return new Promise((resolve) => {
    const options = {
      hostname: "open.api.nexon.com",
      path: path,
      method: "GET",
      headers: { "x-nxopen-api-key": apiKey },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(null); // JSON 파싱 실패 시 null 반환
        }
      });
    });
    req.on("error", () => resolve(null)); // 네트워크 에러 시 null 반환
    req.end();
  });
}

// 메인 로직 핸들러
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

    // 1. OCID 조회
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

    // 2. 필요한 모든 정보를 안전하게 동시에 요청
    const results = await Promise.allSettled([
      nexonApiRequest(
        `/maplestory/v1/character/basic?ocid=${ocid}&date=${dateString}`,
        apiKey
      ), // 0: 기본 정보
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&date=${dateString}&preset_no=1`,
        apiKey
      ), // 1: 프리셋 1 스탯
      nexonApiRequest(
        `/maplestory/v1/item-equipment?ocid=${ocid}&date=${dateString}&preset_no=1`,
        apiKey
      ), // 2: 프리셋 1 장비
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&date=${dateString}&preset_no=2`,
        apiKey
      ), // 3: 프리셋 2 스탯
      nexonApiRequest(
        `/maplestory/v1/item-equipment?ocid=${ocid}&date=${dateString}&preset_no=2`,
        apiKey
      ), // 4: 프리셋 2 장비
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&date=${dateString}&preset_no=3`,
        apiKey
      ), // 5: 프리셋 3 스탯
      nexonApiRequest(
        `/maplestory/v1/item-equipment?ocid=${ocid}&date=${dateString}&preset_no=3`,
        apiKey
      ), // 6: 프리셋 3 장비
    ]);

    // 3. 성공한 요청에서만 데이터 추출
    const basicData =
      results[0].status === "fulfilled" ? results[0].value : null;
    const presetStats = [
      results[1].status === "fulfilled" ? results[1].value : null,
      results[3].status === "fulfilled" ? results[3].value : null,
      results[5].status === "fulfilled" ? results[5].value : null,
    ];
    const presetItems = [
      results[2].status === "fulfilled" ? results[2].value : null,
      results[4].status === "fulfilled" ? results[4].value : null,
      results[6].status === "fulfilled" ? results[6].value : null,
    ];

    if (!basicData) {
      throw new Error("캐릭터의 필수 기본 정보를 불러오지 못했습니다.");
    }

    // 4. 유효한 모든 전투력 찾기
    const combatPowers = presetStats
      .map(
        (statData) =>
          statData?.final_stat?.find((s) => s.stat_name === "전투력")
            ?.stat_value || 0
      )
      .map((power) => parseInt(power))
      .filter((power) => power > 0);

    // 5. 가장 높은 전투력 확정
    const maxCombatPower =
      combatPowers.length > 0 ? Math.max(...combatPowers) : 0;

    // 6. 상세 페이지에 보여줄 전체 아이템 목록 생성 (중복 제거)
    const allItems = new Map();
    presetItems.forEach((itemSet) => {
      itemSet?.item_equipment?.forEach((item) => {
        if (!allItems.has(item.item_name)) {
          allItems.set(item.item_name, item);
        }
      });
    });

    const combinedItemData = { item_equipment: Array.from(allItems.values()) };
    const currentStatData = presetStats[0] || {}; // 현재 스탯은 1번 프리셋 기준

    // 7. 최종 정보 조합하여 전달
    response.status(200).json({
      basicData,
      statData: { ...currentStatData, max_combat_power: maxCombatPower },
      itemData: combinedItemData,
    });
  } catch (error) {
    console.error(
      `[${request.query.characterName}] 서버리스 함수 오류:`,
      error
    );
    response.status(500).json({
      error: "서버에서 요청을 처리하는 중 오류가 발생했습니다.",
      details: error.message,
    });
  }
}
