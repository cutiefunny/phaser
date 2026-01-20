# 1. Node 18 Alpine 버전 사용
FROM node:22-alpine

# 2. 시스템 의존성 설치 (sharp, canvas 등을 위해 필요할 수 있음)
# (혹시 빌드 중 에러나면 이 줄 주석을 푸세요)
# RUN apk add --no-cache python3 make g++

# 1. 시스템 빌드 도구 및 [추가] 타임존 데이터(tzdata) 설치
# Alpine 리눅스는 기본적으로 타임존 데이터가 없어서 설치해야 합니다.
RUN apk add --no-cache python3 make g++ tzdata

# 2. [추가] 타임존 환경변수 설정 (서울)
# 이제부터 서버 내의 모든 시간은 KST(서울) 기준으로 동작합니다.
ENV TZ=Asia/Seoul

WORKDIR /app

# 3. 패키지 파일만 복사
COPY package.json package-lock.json ./

# 4. 의존성 설치 (개발용 툴 제외하고 깔끔하게 설치)
# --omit=dev 옵션은 개발용 라이브러리를 제외하지만, 
# 현재 package.json엔 devDependencies가 없어서 다 설치될 겁니다.
RUN npm ci

# 5. 소스 코드 복사 
# (.dockerignore 덕분에 윈도우용 node_modules는 들어오지 않음!)
COPY . .

# 6. 포트 및 실행
EXPOSE 8000
CMD ["node", "web.js"]