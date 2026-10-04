import { Box } from "@mui/material";
import TextField, { TextFieldProps } from "@mui/material/TextField";
import { useFormContext, Controller } from "react-hook-form"
import { fieldHolder } from "./general";


interface iNumberFieldProps {
    label: string;
    id?: string;
    name: string;
    type?: "int" | "float"
    helperText: string;
    autoComplete?: boolean;
}


const PSNumberField = ({ label, name, type = "int", helperText, id, }: iNumberFieldProps) => {
    if (!id) {
        id = `inpt_` + name;
    }
    const { control, formState: { errors }, } = useFormContext();

    const autoComplete = "off";

    return <Controller
        name={name}
        control={control}
        render={(thing) => {


            const hText: string = (errors[name]?.message ? errors[name].message?.toString() : helperText);
            const error: boolean = (errors[name]?.message ? true : false)
            const textFieldProps: TextFieldProps = {
                value: thing.field.value ? thing.field.value : '',
                onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                    if (type === 'int') {
                        thing.field.onChange(parseInt(event.target.value));
                    } else {
                        thing.field.onChange(parseFloat(event.target.value));
                    }

                },
                type: 'number',
                error,
                label,
                helperText: hText
            }

            return <Box sx={{ ...fieldHolder }}>
                <TextField id={id} name={name} fullWidth {...textFieldProps} autoComplete={autoComplete} slotProps={{
                    input: {
                        autoComplete: autoComplete, // replaces inputProps
                    },
                }} />

            </Box>

        }}


    />
}


export default PSNumberField;