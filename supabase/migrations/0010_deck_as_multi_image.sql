-- Decks publish as multi-image posts, not PDF documents.
--
-- LinkedIn refuses to boost a document post: "This post type can't be boosted.
-- Boosting is only available for text, single or multi-image, article, video,
-- and newsletter posts." A deck she cannot promote only reaches people who
-- already follow her, which defeats the point of posting one while job
-- hunting. The slides are rendered as PNGs anyway, so publishing them as a
-- multi-image post keeps the swipe and stays eligible for promotion.
--
-- `as_document` is the escape hatch for the case where the PDF viewer is worth
-- more than the ability to boost: a document post is downloadable and shows a
-- page counter, which a multi-image post does not.

alter table jobhunt.posts add column if not exists as_document boolean not null default false;

comment on column jobhunt.posts.as_document is
  'Publish a deck as a PDF document instead of a multi-image post. Documents cannot be boosted on LinkedIn, so multi-image is the default; set this only when the swipeable PDF viewer is worth losing promotion.';

grant update (as_document) on jobhunt.posts to authenticated;
