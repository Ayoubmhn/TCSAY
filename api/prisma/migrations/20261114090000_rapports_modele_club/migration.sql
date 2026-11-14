-- Rapports de fin de saison au modèle du club : catégories de dépenses « frais administratifs » et « frais bancaires ».
ALTER TYPE "ExpenseCategory" ADD VALUE 'ADMIN' BEFORE 'OTHER';
ALTER TYPE "ExpenseCategory" ADD VALUE 'BANK' BEFORE 'OTHER';
