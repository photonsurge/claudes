mongosh "mongodb://localhost:27017/crossword" --quiet --eval '
db.words.aggregate([
  { $group: { _id: "$enrichment.status", n: { $sum: 1 } } }
]).toArray()
'