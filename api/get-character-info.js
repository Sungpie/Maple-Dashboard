const https = require("https");

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

    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstOffset);
    kstNow.setDate(kstNow.getDate() - 1);
    const dateString = kstNow.toISOString().split("T")[0];

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

    const results = await Promise.allSettled([
      nexonApiRequest(
        `/maplestory/v1/character/basic?ocid=${ocid}&date=${dateString}`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&date=${dateString}&preset_no=1`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/item-equipment?ocid=${ocid}&date=${dateString}&preset_no=1`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&date=${dateString}&preset_no=2`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/item-equipment?ocid=${ocid}&date=${dateString}&preset_no=2`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&date=${dateString}&preset_no=3`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/item-equipment?ocid=${ocid}&date=${dateString}&preset_no=3`,
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

    const combatPowers = presetStats
      .filter((stat) => stat && stat.final_stat)
      .map((statData) => {
        const powerStat = statData.final_stat.find(
          (s) => s.stat_name === "전투력"
        );
        return powerStat ? parseInt(powerStat.stat_value, 10) : 0;
      })
      .filter((power) => power > 0);

    const maxCombatPower =
      combatPowers.length > 0 ? Math.max(...combatPowers) : 0;

    const allItems = new Map();
    presetItems.forEach((itemSet) => {
      itemSet?.item_equipment?.forEach((item) => {
        if (!allItems.has(item.item_name)) {
          allItems.set(item.item_name, item);
        }
      });
    });

    const combinedItemData = { item_equipment: Array.from(allItems.values()) };
    const currentStatData = presetStats[0];

    // Vercel의 모든 캐시를 무력화하는 가장 강력한 헤더
    response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Expires", "0");

    response.status(200).json({
      basicData,
      statData: { ...currentStatData, max_combat_power: maxCombatPower },
      itemData: combinedItemData,
      // ✨ [핵심 수정] 데이터 기준일을 함께 전달
      data_date: dateString,
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
