import type { NoteDocument } from "../domain/contracts";

export type SampleNote = {
  id: string;
  title: string;
  document: NoteDocument;
  tags: string[];
  updatedAt: string;
};
export type SampleClip = {
  id: string;
  title: string;
  source: string;
  tags: string[];
  paragraphs: string[];
  read: boolean;
};
export type SampleCard = { question: string; answer: string };
export const sampleDecks: { id: string; title: string; cards: SampleCard[] }[] =
  [
    {
      id: "biology",
      title: "Biology: chapter 5",
      cards: [
        {
          question: "Where does glycolysis take place?",
          answer: "In the cytoplasm.",
        },
        {
          question: "What is the main energy currency of the cell?",
          answer: "ATP (adenosine triphosphate).",
        },
        {
          question:
            "Which molecule is the final electron acceptor in aerobic respiration?",
          answer:
            "Oxygen. It combines with electrons and protons to form water.",
        },
      ],
    },
    {
      id: "portuguese",
      title: "Portuguese basics",
      cards: [
        {
          question: "How do you say good morning in Portuguese?",
          answer: "Bom dia.",
        },
        {
          question: "What does ‘até amanhã’ mean?",
          answer: "See you tomorrow.",
        },
      ],
    },
  ];

export function sampleDocument(...paragraphs: string[]): NoteDocument {
  return {
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: text ? [{ type: "text", text }] : [],
    })),
  };
}
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function offsetDay(date: Date, offset: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + offset,
    12,
  );
}
export function createSample(now = new Date()) {
  const today = offsetDay(now, 0);
  const notes: SampleNote[] = [
    {
      id: "lisbon",
      title: "Lisbon trip, May",
      tags: ["trip"],
      updatedAt: today.toISOString(),
      document: sampleDocument(
        "Three nights in Alfama with Maya. Flights are booked; the rest is below.",
        "Before we go",
        "Reserve a small apartment near the tram. Pack comfortable shoes, a light jacket and the little camera.",
        "Leave Saturday afternoon free. Walk along the river, find a café and write down the places we want to return to.",
      ),
    },
    {
      id: "biology",
      title: "Biology: chapter 5",
      tags: ["study"],
      updatedAt: offsetDay(today, -1).toISOString(),
      document: sampleDocument(
        "Cell respiration: glycolysis, the Krebs cycle and the electron transport chain.",
        "Glycolysis takes place in the cytoplasm. The Krebs cycle produces electron carriers, including NADH and FADH₂.",
        "Try recalling each stage before looking at the diagram. Make a short practice card for anything that is still unclear.",
      ),
    },
    {
      id: "launch",
      title: "Spring launch checklist",
      tags: ["launch"],
      updatedAt: offsetDay(today, -2).toISOString(),
      document: sampleDocument(
        "Announcement draft, pricing page and support notes.",
        "Priya is reviewing the announcement on Thursday. Leave time to check every link and prepare a short answer to the questions we hear most often.",
      ),
    },
    {
      id: "weekend",
      title: "A quieter weekend",
      tags: ["home"],
      updatedAt: offsetDay(today, -3).toISOString(),
      document: sampleDocument(
        "Buy herbs for the kitchen window. Fix the loose shelf. Make a big pot of soup.",
        "Keep Sunday morning open for a long walk and a chapter of the book on the bedside table.",
      ),
    },
    {
      id: "phrases",
      title: "A few words for the trip",
      tags: ["trip", "study"],
      updatedAt: offsetDay(today, -4).toISOString(),
      document: sampleDocument(
        "Bom dia — good morning. Obrigada — thank you. Até amanhã — see you tomorrow.",
        "A little practice each day is easier than trying to remember everything on the plane.",
      ),
    },
  ];
  const clips: SampleClip[] = [
    {
      id: "slow-travel",
      title: "A slower way to explore Lisbon",
      source: "Wander Journal · Sample article",
      tags: ["trip"],
      read: false,
      paragraphs: [
        "Start in Alfama before breakfast. The narrow streets are quiet, the cafés are opening, and there is no need to decide where the whole day will take you.",
        "Choose one place you really want to visit, then leave room around it. A small museum, a walk by the water and a long lunch can be a complete day.",
        "Keep a few notes instead of a packed itinerary. The bakery you passed, the view at the top of the hill, the street you want to walk again: those are the things that make the trip yours.",
      ],
    },
    {
      id: "recall",
      title: "Make room for active recall",
      source: "Learning Notes · Sample article",
      tags: ["study"],
      read: false,
      paragraphs: [
        "Before reopening your notes, try to explain one idea from memory. The pause is useful: it shows what you understand and what needs another look.",
        "Keep practice questions short and specific. Review an answer after trying to recall it, then return to the parts that still feel uncertain.",
        "A few minutes of focused practice can fit into an ordinary day. Consistency matters more than filling a calendar with ambitious sessions.",
      ],
    },
    {
      id: "small-teams",
      title: "A launch checklist for small teams",
      source: "Maker Handbook · Sample article",
      tags: ["launch"],
      read: true,
      paragraphs: [
        "Give each launch task an owner and an observable finish line. A checked box should mean the work can be reviewed, not just that someone has started it.",
        "Read the announcement out loud. Follow the links as a new visitor would. Keep the support notes close, and leave room for the questions you did not predict.",
      ],
    },
  ];
  return {
    today,
    notes,
    clips,
    journal: {
      [dayKey(today)]:
        "Maya finally agreed on Alfama. Priya’s feedback was kinder than I feared. A walk after lunch helped me think clearly again.",
      [dayKey(offsetDay(today, -1))]:
        "Finished the biology chapter and made a few questions to practise tomorrow. Dinner with a friend was the best part of the day.",
      [dayKey(offsetDay(today, -2))]:
        "A quiet morning, coffee by the window and a little time to read before work.",
    } as Record<string, string>,
  };
}
