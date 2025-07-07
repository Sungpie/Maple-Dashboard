// api/get-character-info.js

export default async function handler(request, response) {
  // 1. 클라이언트(브라우저)가 요청한 캐릭터 이름 가져오기
  const { searchParams } = new URL(request.url);
  const characterName = searchParams.get("characterName");

  if (!characterName) {
    return response.status(400).json({ error: "캐릭터 이름이 필요합니다." });
  }

  // 2. Vercel에 안전하게 저장된 API 키 가져오기
  const apiKey = process.env.NEXON_API_KEY;

  const myHeaders = new Headers();
  myHeaders.append("x-nxopen-api-key", apiKey);

  try {
    // 3. 어제 날짜 계산
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateString = yesterday.toISOString().split("T")[0];

    // 4. 넥슨 서버에 OCID 요청
    const ocidResponse = await fetch(
      `https://open.api.nexon.com/maplestory/v1/id?character_name=${characterName}`,
      { headers: myHeaders }
    );
    if (!ocidResponse.ok) throw new Error("OCID 조회 실패");
    const ocidData = await ocidResponse.json();
    const ocid = ocidData.ocid;

    if (!ocid) {
      return response.status(404).json({ error: "캐릭터를 찾을 수 없습니다." });
    }

    // 5. 필요한 모든 정보를 동시에 요청
    const [basicData, statData, itemData] = await Promise.all([
      fetch(
        `https://open.api.nexon.com/maplestory/v1/character/basic?ocid=${ocid}&date=${dateString}`,
        { headers: myHeaders }
      ).then((res) => res.json()),
      fetch(
        `https://open.api.nexon.com/maplestory/v1/character/stat?ocid=${ocid}&date=${dateString}`,
        { headers: myHeaders }
      ).then((res) => res.json()),
      fetch(
        `https://open.api.nexon.com/maplestory/v1/character/item-equipment?ocid=${ocid}&date=${dateString}`,
        { headers: myHeaders }
      ).then((res) => res.json()),
    ]);

    // 6. 모든 정보를 합쳐서 클라이언트에게 전달
    response.status(200).json({
      basicData,
      statData,
      itemData,
    });
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: "서버에서 오류가 발생했습니다." });
  }
}
