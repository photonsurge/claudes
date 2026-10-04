import { Box } from "@mui/material";
import { useFormContext, Controller } from "react-hook-form";
import { fieldHolder } from "./general";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs, { Dayjs } from "dayjs";
import 'dayjs/locale/en-gb'; // <-- add this
import { getFieldError } from "./getFieldError";
interface iDatePickerProps {
  label: string;
  name: string;
  id?: string;
  helperText?: string;
}

const PSDatePicker = ({ label, name, id, helperText }: iDatePickerProps) => {
  const {
    control,
    formState: { errors },
  } = useFormContext();

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="en-gb">
      <Controller
        name={name}
        control={control}
        render={({ field }) => {
          const { message, hasError } = getFieldError(errors, name);
          const hText: string|undefined = message ?? helperText;
          const errorBool: boolean = hasError;


          return (
            <Box sx={{ ...fieldHolder }}>
              <DatePicker
                label={label}
                format="DD/MM/YYYY"
                value={field.value ? dayjs(field.value) : null}
                onChange={(newValue: Dayjs | null) => {
                  // Store as JS Date for zod.date()
                  const set = newValue ? newValue.toDate() : null;

                  console.log(set, typeof set)
                  field.onChange(set);
                }}
                slotProps={{
                  textField: {
                    id,
                    name,
                    fullWidth: true,
                    error: hasError,
                    helperText: hText,
                  },
                }}
              />
            </Box>
          );
        }}
      />
    </LocalizationProvider>
  );
};

export default PSDatePicker;
