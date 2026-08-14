-- 向量相似度检索函数（pgvector）
-- 用于 RAG 语义检索，通过余弦距离排序

CREATE OR REPLACE FUNCTION match_knowledge_vectors(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  filter_user_id text DEFAULT NULL
)
RETURNS TABLE (
  id text,
  doc_id text,
  chunk text,
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    kv.id,
    kv.doc_id,
    kv.chunk,
    1 - (kv.embedding <=> query_embedding) AS similarity
  FROM knowledge_vectors kv
  WHERE filter_user_id IS NULL OR kv.user_id = filter_user_id
  ORDER BY kv.embedding <=> query_embedding
  LIMIT match_count;
$$;
