# Light Frontend (Bucket 1)

## Run

1. Backend API:

```bash
npm run dev
```

2. Frontend app:

```bash
cd frontend
cp .env.example .env
# Fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Frontend default URL: `http://localhost:5173`

## Required frontend env

- `VITE_API_BASE_URL` (default `http://localhost:3000`)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
