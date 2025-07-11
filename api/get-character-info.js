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
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
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

    // 1. OCID 조회 (date 파라미터 불필요)
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

    // ✨ [핵심 수정] 2. date 파라미터 없이 API 요청
    const results = await Promise.allSettled([
      nexonApiRequest(`/maplestory/v1/character/basic?ocid=${ocid}`, apiKey),
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&preset_no=1`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/item-equipment?ocid=${ocid}&preset_no=1`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&preset_no=2`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/item-equipment?ocid=${ocid}&preset_no=2`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&preset_no=3`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/item-equipment?ocid=${ocid}&preset_no=3`,
        apiKey
      ),
    ]);

    const getValue = (result) =>
      result.status === "fulfilled" ? result.value : null;

    const basicData = getValue(results[0]);
    const presetStats = [
      getValue(results[1]),
      getValue(results[3]),
      getValue(results[5]),
    ];
    const presetItems = [
      getValue(results[2]),
      getValue(results[4]),
      getValue(results[6]),
    ];

    if (!basicData) {
      throw new Error("캐릭터의 필수 기본 정보를 불러오지 못했습니다.");
    }

    // 3. 유효한 모든 전투력 찾기
    const combatPowers = presetStats
      .filter((stat) => stat && stat.final_stat)
      .map((statData) => {
        const powerStat = statData.final_stat.find(
          (s) => s.stat_name === "전투력"
        );
        return powerStat ? parseInt(powerStat.stat_value, 10) : 0;
      })
      .filter((power) => power > 0);

    // 4. 가장 높은 전투력 확정
    const maxCombatPower =
      combatPowers.length > 0 ? Math.max(...combatPowers) : 0;

    // 5. 전체 아이템 목록 생성
    const allItems = new Map();
    presetItems.forEach((itemSet) => {
      itemSet?.item_equipment?.forEach((item) => {
        if (!allItems.has(item.item_name)) {
          allItems.set(item.item_name, item);
        }
      });
    });

    const combinedItemData = { item_equipment: Array.from(allItems.values()) };
    const currentStatData = presetStats[0]; // 1번 프리셋을 현재 스탯으로 간주

    // 6. Vercel 캐시 제어 헤더 설정
    response.setHeader("Cache-Control", "s-maxage=1, stale-while-revalidate");

    response.status(200).json({
      basicData,
      statData: { ...currentStatData, max_combat_power: maxCombatPower },
      itemData: combinedItemData,
      data_date: basicData.date, // ✨ basicData에 포함된 최신 데이터 기준일을 사용
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
