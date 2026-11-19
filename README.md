# 일일서류

건설현장 안전관리자가 매일 쓰는 서류 5종을 입력하고, A4로 인쇄하고, PDF·JSON으로 보관하는 데스크톱 프로그램입니다.

① 안전교육일지 · ② T.B.M 사진대지 · ③ 안전 순회 점검표 · ④ 무인 타워크레인 점검일지 · ⑤ T.B.M 일지(위험성평가)

- 날짜별 저장, 전날 내용 이월, 자동 합산, A4 인쇄·PDF 만들기, 추가 백업 폴더 지정
- 선택 기능: AI로 교육내용·위험성평가 초안 작성(버튼을 누를 때만 동작, 항상 미리보기 후 적용), 공정표 기반 주간/월간 T.B.M 일지 일괄 생성, 위험성평가 라이브러리(자동 누적·재사용)
- 사용 방법은 프로그램 안의 "사용 가이드" 또는 [docs/사용가이드.md](docs/사용가이드.md)를 보세요.

## 개발

Tauri 2(Rust) + 바닐라 HTML/CSS/JS 입니다.

```
npm install
npm run tauri dev                          # 개발 실행
npm run tauri build -- --bundles nsis      # Windows 설치 파일
```

테스트(Node):

```
node tests/ai_prompts.test.js   # tests/ 의 나머지 *.test.js 도 같은 방식
```

## 문의

문의 : hguyswow@gmail.com
