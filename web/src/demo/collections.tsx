import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
} from "../ui/icons";
import { dayKey, offsetDay, sampleDecks, type SampleClip } from "./fixtures";

const habits = [
  { id: "read", label: "Read 20 minutes" },
  { id: "walk", label: "Walk 30 minutes" },
  { id: "water", label: "Drink water" },
];
export function SampleJournal({
  day,
  today,
  onDay,
  text,
  onText,
  completed,
  onToggle,
}: {
  day: Date;
  today: Date;
  onDay: (day: Date) => void;
  text: string;
  onText: (text: string) => void;
  completed: string[];
  onToggle: (id: string) => void;
}) {
  const isToday = dayKey(day) === dayKey(today);
  const week = Array.from({ length: 7 }, (_, index) =>
    offsetDay(today, index - 6),
  );
  return (
    <>
      <header className="sample-page-header">
        <h1>Journal</h1>
        <span>
          {day.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </span>
        <div className="sample-actions">
          <button
            aria-label="Previous day"
            onClick={() => onDay(offsetDay(day, -1))}
          >
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => onDay(today)} disabled={isToday}>
            Today
          </button>
          <button
            aria-label="Next day"
            disabled={isToday}
            onClick={() => onDay(offsetDay(day, 1))}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </header>
      <div className="sample-journal-layout">
        <section className="sample-journal-writing">
          <div className="sample-day-strip" aria-label="Recent days">
            {week.map((date) => (
              <button
                key={dayKey(date)}
                aria-label={date.toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                })}
                aria-pressed={dayKey(date) === dayKey(day)}
                onClick={() => onDay(date)}
              >
                <small>
                  {date.toLocaleDateString(undefined, { weekday: "short" })}
                </small>
                <strong>{date.getDate()}</strong>
              </button>
            ))}
          </div>
          <p className="sample-group">Daily prompt</p>
          <h2>What made today a little better?</h2>
          <label className="sample-journal-label">
            {isToday ? "Today’s entry" : "Journal entry"}
            <textarea
              aria-label="Sample journal entry"
              placeholder="Start with a moment from your day…"
              value={text}
              onChange={(event) => onText(event.target.value)}
            />
          </label>
          <p className="sample-muted">Updated in sample</p>
        </section>
        <aside className="sample-habits">
          <CalendarDays size={18} />
          <h2>Daily habits</h2>
          <p className="sample-muted">
            {completed.length} of {habits.length} complete
          </p>
          {habits.map((habit) => (
            <label className="sample-habit" key={habit.id}>
              <input
                type="checkbox"
                checked={completed.includes(habit.id)}
                onChange={() => onToggle(habit.id)}
              />
              <span>{habit.label}</span>
            </label>
          ))}
        </aside>
      </div>
    </>
  );
}

export function SampleStudy({
  deckId,
  onDeck,
  cardIndex,
  answer,
  onAnswer,
  onNext,
}: {
  deckId: string | null;
  onDeck: (id: string | null) => void;
  cardIndex: number;
  answer: boolean;
  onAnswer: () => void;
  onNext: () => void;
}) {
  const deck = sampleDecks.find((item) => item.id === deckId);
  const card = deck?.cards[cardIndex];
  return (
    <>
      <header className="sample-page-header">
        <h1>Study</h1>
        <span>
          {sampleDecks.reduce((sum, item) => sum + item.cards.length, 0)} sample
          cards
        </span>
        {deck && (
          <button onClick={() => onDeck(null)}>
            <ArrowLeft size={15} />
            All decks
          </button>
        )}
      </header>
      {deck ? (
        <section className="sample-practice">
          <p className="sample-muted">{deck.title} · Practice only</p>
          {card ? (
            <>
              <p className="sample-muted">
                Card {cardIndex + 1} of {deck.cards.length}
              </p>
              <div className="sample-flashcard">
                <BookOpen size={20} />
                <h2>{card.question}</h2>
                {answer && <p className="sample-card-answer">{card.answer}</p>}
              </div>
              <div className="sample-actions">
                {answer ? (
                  <button className="primary" onClick={onNext}>
                    Next card
                    <ChevronRight size={16} />
                  </button>
                ) : (
                  <button className="primary" onClick={onAnswer}>
                    Show answer
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="sample-empty">
              <Check size={24} />
              <h2>Practice complete</h2>
              <p>You’ve reached the end of this sample deck.</p>
              <button className="primary" onClick={() => onDeck(deck.id)}>
                Practise again
              </button>
            </div>
          )}
          <p className="sample-muted">
            Sample practice does not schedule reviews.
          </p>
        </section>
      ) : (
        <>
          <div className="sample-section-intro">
            <h2>Your decks</h2>
            <p className="sample-muted">Try a few practice cards.</p>
          </div>
          <div className="sample-decks">
            {sampleDecks.map((item) => (
              <button
                className="sample-deck"
                key={item.id}
                onClick={() => onDeck(item.id)}
              >
                <BookOpen size={20} />
                <strong>{item.title}</strong>
                <span>{item.cards.length} cards</span>
                <span>
                  Practise
                  <ChevronRight size={14} />
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export function SampleClips({
  clips,
  selected,
  onSelect,
  filter,
  onFilter,
  onRead,
}: {
  clips: SampleClip[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  filter: "all" | "unread" | "read";
  onFilter: (filter: "all" | "unread" | "read") => void;
  onRead: (id: string, read: boolean) => void;
}) {
  const clip = clips.find((item) => item.id === selected);
  const visible = clips.filter(
    (item) => filter === "all" || (filter === "read" ? item.read : !item.read),
  );
  return (
    <>
      <header className="sample-page-header">
        <h1>Clips</h1>
        <span>{clips.length} sample articles</span>
        {clip && (
          <button onClick={() => onSelect(null)}>
            <ArrowLeft size={15} />
            Back to clips
          </button>
        )}
      </header>
      {clip ? (
        <article className="sample-clip-reader">
          <p className="sample-muted">{clip.source}</p>
          <h2>{clip.title}</h2>
          <div className="sample-meta">
            {clip.tags.map((tag) => (
              <span className="sample-tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          {clip.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <button onClick={() => onRead(clip.id, !clip.read)}>
            {clip.read ? "Mark unread" : "Mark as read"}
          </button>
          <p className="sample-muted">
            {clip.read ? "Read in sample" : "Unread"}
          </p>
        </article>
      ) : (
        <>
          <div className="sample-filters" aria-label="Clip filters">
            {(["all", "unread", "read"] as const).map((value) => (
              <button
                aria-pressed={filter === value}
                key={value}
                onClick={() => onFilter(value)}
              >
                {value === "all"
                  ? "All"
                  : value === "unread"
                    ? "Unread"
                    : "Read"}
                <span>
                  {
                    clips.filter(
                      (item) =>
                        value === "all" ||
                        (value === "read" ? item.read : !item.read),
                    ).length
                  }
                </span>
              </button>
            ))}
          </div>
          <div className="sample-clip-list">
            {visible.map((item) => (
              <button
                key={item.id}
                className="sample-clip-row"
                onClick={() => onSelect(item.id)}
              >
                <FileText size={19} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.source}</small>
                  <span className="sample-excerpt">{item.paragraphs[0]}</span>
                </span>
                <span className="sample-muted">
                  {item.read ? "Read" : "Unread"}
                </span>
              </button>
            ))}
          </div>
          {!visible.length && (
            <div className="sample-empty">
              <h2>No {filter} clips</h2>
              <button onClick={() => onFilter("all")}>Show all clips</button>
            </div>
          )}
        </>
      )}
    </>
  );
}
