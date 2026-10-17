-- Two databases on one Postgres: the brain (agents, users, records) and n8n (workflows, executions).
CREATE DATABASE swarm;
CREATE DATABASE n8n;
\c swarm
CREATE EXTENSION IF NOT EXISTS vector;
