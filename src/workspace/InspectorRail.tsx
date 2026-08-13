import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, X } from "lucide-react";
import { useInspectorStore } from "@/stores/cross-filter-store";
import { Button } from "@/ui/Button";
import styles from "./InspectorRail.module.css";

export function InspectorRail() {
  const { open, title, content, history, closeInspector, backInspector } = useInspectorStore();

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className={styles.rail}
          initial={{ x: "100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          <div className={styles.head}>
            {history.length > 0 && (
              <Button variant="ghost" size="sm" onClick={backInspector} aria-label="Back">
                <ChevronLeft size={18} />
              </Button>
            )}
            <h2>{title}</h2>
            <Button variant="ghost" size="sm" onClick={closeInspector} aria-label="Close">
              <X size={18} />
            </Button>
          </div>
          <div className={styles.body}>{content}</div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
